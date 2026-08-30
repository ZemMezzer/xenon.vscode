import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  RevealOutputChannelOn,
  type ErrorHandler,
  type InitializeParams,
  type LanguageClientOptions,
  type Middleware,
  type ServerOptions
} from "vscode-languageclient/node";
import {
  classifyStartupFailure,
  getErrorMessage,
  selectExecutable,
  type ExecutableSelection
} from "./executable";
import {
  isOutsideWorkspaceXenonDocument,
  isXenonFileDocument,
  needsStandaloneClient
} from "./routing";

const OPEN_SETTINGS = "Open Settings";
const SHOW_OUTPUT = "Show Output";
const RESTART_SERVER = "Restart";
const STANDALONE_KEY = "standalone";

interface ClientTargetBase {
  readonly key: string;
  readonly label: string;
}

type ClientTarget = ClientTargetBase & (
  | { readonly kind: "folder"; readonly folder: vscode.WorkspaceFolder }
  | { readonly kind: "standalone"; readonly folder?: never }
);

interface ClientRuntimeState {
  readonly label: string;
  intentionalStop: boolean;
}

interface ClientSlot {
  readonly instanceId: string;
  readonly target: ClientTarget;
  readonly client: LanguageClient;
  readonly watchers: readonly vscode.FileSystemWatcher[];
  readonly watcherListeners: readonly vscode.Disposable[];
  readonly state: ClientRuntimeState;
}

class XenonLanguageClient extends LanguageClient {
  public constructor(
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
    private readonly standalone: boolean
  ) {
    super(id, name, serverOptions, clientOptions);
  }

  protected override fillInitializeParams(params: InitializeParams): void {
    super.fillInitializeParams(params);
    if (this.standalone) {
      // vscode-languageclient otherwise derives the first VS Code workspace folder as root.
      // An outside-workspace client must initialize without a project root so xenon lsp
      // creates only loose/ad-hoc contexts for the documents routed to it.
      params.rootPath = null;
      params.rootUri = null;
      params.workspaceFolders = null;
    }
  }
}

export class XenonLanguageClientManager implements vscode.Disposable {
  private readonly clients = new Map<string, ClientSlot>();
  private transition: Promise<void> = Promise.resolve();
  private nextClientId = 1;
  private disposed = false;
  private failureNotificationShown = false;
  private standaloneRetained = false;
  private topologyGeneration = 0;

  public constructor(public readonly output: vscode.OutputChannel) {}

  public start(reason = "extension activation"): Promise<void> {
    return this.enqueue(() => this.reconcileTopology(reason, false));
  }

  public refreshWorkspaceFolders(reason: string): Promise<void> {
    return this.enqueue(() => this.reconcileTopology(reason, false));
  }

  public rebuildWorkspaceTopology(reason: string): Promise<void> {
    return this.enqueue(() => this.reconcileTopology(reason, true));
  }

  public restart(reason: string): Promise<void> {
    return this.enqueue(() => this.reconcileTopology(`restart requested: ${reason}`, true));
  }

  public showOutput(): void {
    this.output.show(true);
  }

  public getActiveTargetKeys(): Promise<readonly string[]> {
    return this.transition.then(() => [...this.clients.keys()]);
  }

  public getTopologySnapshot(): Promise<{
    readonly generation: number;
    readonly clients: readonly {
      readonly key: string;
      readonly instanceId: string;
      readonly watcherCount: number;
    }[];
  }> {
    return this.transition.then(() => ({
      generation: this.topologyGeneration,
      clients: [...this.clients.values()].map((slot) => ({
        key: slot.target.key,
        instanceId: slot.instanceId,
        watcherCount: slot.watchers.length
      }))
    }));
  }

  public getDocumentOwnerKeys(uri: vscode.Uri): Promise<readonly string[]> {
    return this.transition.then(() => {
      const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
      if (document === undefined) {
        return [];
      }
      return [...this.clients.values()]
        .filter((slot) => this.ownsDocument(slot.target, document))
        .map((slot) => slot.target.key);
    });
  }

  public async disposeAsync(): Promise<void> {
    if (this.disposed) {
      await this.transition;
      return;
    }

    this.disposed = true;
    await this.enqueue(() => this.stopAllClients("extension deactivation"));
  }

  public dispose(): void {
    void this.disposeAsync();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation, operation);
    this.transition = result.catch((error: unknown) => {
      this.output.appendLine(`[lifecycle] Unexpected lifecycle error: ${getErrorMessage(error)}`);
    });
    return result;
  }

  private async reconcileTopology(reason: string, rebuildAll: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (rebuildAll) {
      this.topologyGeneration++;
      this.failureNotificationShown = false;
      this.output.appendLine(`[topology] Rebuilding all Xenon routing domains: ${reason}.`);
      await this.stopAllClients(`topology rebuild: ${reason}`);
    }

    const targets = this.getDesiredTargets();
    const desiredKeys = new Set(targets.map((target) => target.key));
    for (const slot of [...this.clients.values()]) {
      if (!desiredKeys.has(slot.target.key)) {
        await this.stopClient(slot, `routing target removed: ${reason}`);
      }
    }

    for (const target of targets) {
      if (!this.clients.has(target.key)) {
        await this.startClient(target, reason);
      }
    }
  }

  private getDesiredTargets(): ClientTarget[] {
    const folders = vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === "file") ?? [];
    const targets: ClientTarget[] = folders.map((folder) => ({
      key: folder.uri.toString(),
      label: `${folder.name} (${folder.uri.fsPath})`,
      kind: "folder",
      folder
    }));

    if (needsStandaloneClient(
      vscode.workspace.textDocuments,
      (document) => vscode.workspace.getWorkspaceFolder(document.uri) !== undefined
    )) {
      this.standaloneRetained = true;
    }

    if (this.standaloneRetained) {
      targets.push({ key: STANDALONE_KEY, label: "outside-workspace files", kind: "standalone" });
    }

    return targets;
  }

  private async startClient(target: ClientTarget, reason: string): Promise<void> {
    const configuredPath = vscode.workspace.getConfiguration("xenon").get<unknown>("executablePath");
    const executable = selectExecutable(configuredPath);
    this.logStartup(target, executable, reason);

    const watchers = this.createWatchers(target);
    const watcherListeners = this.createWatcherLogging(target, watchers);
    const state: ClientRuntimeState = { label: target.label, intentionalStop: false };
    const serverOptions: ServerOptions = {
      command: executable.command,
      args: ["lsp"],
      options: { shell: false }
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: this.createDocumentSelector(target) as LanguageClientOptions["documentSelector"],
      outputChannel: this.output,
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      errorHandler: this.createErrorHandler(state),
      middleware: this.createRoutingMiddleware(target),
      uriConverters: {
        // The current .NET Language Server expects a literal Windows drive separator.
        code2Protocol: (uri) => uri.toString(true),
        protocol2Code: (value) => vscode.Uri.parse(value)
      },
      ...(watchers.length === 0 ? {} : { synchronize: { fileEvents: watchers } }),
      ...(target.kind === "standalone" ? {} : { workspaceFolder: target.folder })
    };

    const instanceId = `xenonLanguageServer-${this.nextClientId++}`;
    const client = new XenonLanguageClient(
      instanceId,
      `Xenon Language Server — ${target.label}`,
      serverOptions,
      clientOptions,
      target.kind === "standalone"
    );
    const slot: ClientSlot = { instanceId, target, client, watchers, watcherListeners, state };
    this.clients.set(target.key, slot);

    try {
      await client.start();
      this.failureNotificationShown = false;
      this.output.appendLine(`[lifecycle:${target.label}] Xenon Language Server initialized.`);
    } catch (error: unknown) {
      this.output.appendLine(
        `[startup:${target.label}] Failed to start Xenon Language Server: ${getErrorMessage(error)}`
      );
      this.releaseFailedClient(slot);
      void this.notifyStartupFailure(error, executable, target.label);
    }
  }

  private createDocumentSelector(target: ClientTarget): vscode.DocumentFilter[] {
    if (target.kind === "standalone") {
      return [{ scheme: "file", language: "xenon" }];
    }

    return [{
      scheme: "file",
      language: "xenon",
      pattern: new vscode.RelativePattern(target.folder, "**/*.xe")
    }];
  }

  private createWatchers(target: ClientTarget): vscode.FileSystemWatcher[] {
    if (target.kind === "standalone") {
      return [];
    }

    const patterns = ["**/*.xe", "**/*.xeproj", "**/*.xws"];
    return patterns.map((pattern) => vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(target.folder, pattern)
    ));
  }

  private createWatcherLogging(
    target: ClientTarget,
    watchers: readonly vscode.FileSystemWatcher[]
  ): vscode.Disposable[] {
    const kinds = [".xe", ".xeproj", ".xws"];
    return watchers.flatMap((watcher, index) => {
      const kind = kinds[index] ?? "file";
      return [
        watcher.onDidCreate((uri) => this.logWatcherEvent(target, "created", kind, uri)),
        watcher.onDidChange((uri) => this.logWatcherEvent(target, "changed", kind, uri)),
        watcher.onDidDelete((uri) => this.logWatcherEvent(target, "deleted", kind, uri))
      ];
    });
  }

  private logWatcherEvent(target: ClientTarget, event: string, kind: string, uri: vscode.Uri): void {
    const path = target.folder === undefined ? uri.fsPath : vscode.workspace.asRelativePath(uri, false);
    this.output.appendLine(`[watch:${target.label}] ${event} ${kind}: ${path}`);
  }

  private createRoutingMiddleware(target: ClientTarget): Middleware {
    const owns = (document: vscode.TextDocument): boolean => this.ownsDocument(target, document);
    return {
      didOpen: (document, next) => owns(document) ? next(document) : Promise.resolve(),
      didChange: (event, next) => owns(event.document) ? next(event) : Promise.resolve(),
      didSave: (document, next) => owns(document) ? next(document) : Promise.resolve(),
      didClose: (document, next) => owns(document) ? next(document) : Promise.resolve(),
      provideHover: (document, position, token, next) =>
        owns(document) ? next(document, position, token) : undefined,
      provideCompletionItem: (document, position, context, token, next) =>
        owns(document) ? next(document, position, context, token) : undefined,
      provideSignatureHelp: (document, position, context, token, next) =>
        owns(document) ? next(document, position, context, token) : undefined,
      provideDefinition: (document, position, token, next) =>
        owns(document) ? next(document, position, token) : undefined,
      provideTypeDefinition: (document, position, token, next) =>
        owns(document) ? next(document, position, token) : undefined,
      provideImplementation: (document, position, token, next) =>
        owns(document) ? next(document, position, token) : undefined,
      provideReferences: (document, position, options, token, next) =>
        owns(document) ? next(document, position, options, token) : undefined,
      provideDocumentSymbols: (document, token, next) =>
        owns(document) ? next(document, token) : undefined,
      prepareRename: (document, position, token, next) =>
        owns(document) ? next(document, position, token) : undefined,
      provideRenameEdits: (document, position, newName, token, next) =>
        owns(document) ? next(document, position, newName, token) : undefined,
      provideDocumentSemanticTokens: (document, token, next) =>
        owns(document) ? next(document, token) : undefined,
      provideDocumentSemanticTokensEdits: (document, previousResultId, token, next) =>
        owns(document) ? next(document, previousResultId, token) : undefined
    };
  }

  private ownsDocument(target: ClientTarget, document: vscode.TextDocument): boolean {
    if (!isXenonFileDocument(document)) {
      return false;
    }

    if (target.kind === "standalone") {
      return isOutsideWorkspaceXenonDocument(
        document,
        (candidate) => vscode.workspace.getWorkspaceFolder(candidate.uri) !== undefined
      );
    }

    const owner = vscode.workspace.getWorkspaceFolder(document.uri);
    return owner?.uri.toString() === target.folder.uri.toString();
  }

  private async stopAllClients(reason: string): Promise<void> {
    for (const slot of [...this.clients.values()]) {
      await this.stopClient(slot, reason);
    }
  }

  private async stopClient(slot: ClientSlot, reason: string): Promise<void> {
    if (!this.clients.delete(slot.target.key)) {
      return;
    }

    slot.state.intentionalStop = true;
    this.output.appendLine(`[lifecycle:${slot.target.label}] Stopping Xenon Language Server: ${reason}.`);
    try {
      await slot.client.stop();
    } catch (error: unknown) {
      this.output.appendLine(
        `[lifecycle:${slot.target.label}] Language Server stop reported: ${getErrorMessage(error)}`
      );
    } finally {
      this.disposeSlotResources(slot);
      this.output.appendLine(`[lifecycle:${slot.target.label}] Xenon Language Server stopped.`);
    }
  }

  private releaseFailedClient(slot: ClientSlot): void {
    if (this.clients.get(slot.target.key) === slot) {
      this.clients.delete(slot.target.key);
    }
    // vscode-languageclient owns failed-start transport cleanup. stop/dispose throws while
    // its state is startFailed, so only extension-owned resources are released here.
    this.disposeSlotResources(slot);
  }

  private disposeSlotResources(slot: ClientSlot): void {
    for (const listener of slot.watcherListeners) {
      listener.dispose();
    }
    for (const watcher of slot.watchers) {
      watcher.dispose();
    }
  }

  private createErrorHandler(state: ClientRuntimeState): ErrorHandler {
    return {
      error: (error, _message, count) => {
        this.output.appendLine(
          `[client:${state.label}] LSP connection error${count === undefined ? "" : ` #${count}`}: ${getErrorMessage(error)}`
        );
        return { action: ErrorAction.Continue };
      },
      closed: () => {
        if (state.intentionalStop) {
          return { action: CloseAction.DoNotRestart };
        }

        this.output.appendLine(
          `[client:${state.label}] Xenon Language Server exited unexpectedly. Automatic restart is disabled.`
        );
        void this.notifyUnexpectedExit(state.label);
        return { action: CloseAction.DoNotRestart };
      }
    };
  }

  private logStartup(target: ClientTarget, executable: ExecutableSelection, reason: string): void {
    const origin = executable.source === "configuration" ? "xenon.executablePath" : "PATH";
    this.output.appendLine(`[startup:${target.label}] Starting '${executable.command}' with arguments ['lsp'].`);
    this.output.appendLine(`[startup:${target.label}] Executable source: ${origin}; reason: ${reason}.`);
  }

  private async notifyStartupFailure(
    error: unknown,
    executable: ExecutableSelection,
    label: string
  ): Promise<void> {
    if (this.failureNotificationShown || this.disposed) {
      return;
    }
    this.failureNotificationShown = true;

    const kind = classifyStartupFailure(error);
    let message: string;
    if (kind === "not-found") {
      message = executable.source === "configuration"
        ? `The configured Xenon executable was not found for ${label}. Check xenon.executablePath.`
        : "Xenon executable was not found. Add 'xenon' to PATH or configure xenon.executablePath.";
    } else if (kind === "permission-denied") {
      message = `The Xenon executable for ${label} could not be started because permission was denied.`;
    } else {
      message = `Xenon Language Server for ${label} could not be started. See output for details.`;
    }

    const action = await vscode.window.showErrorMessage(message, OPEN_SETTINGS, SHOW_OUTPUT);
    await this.handleFailureAction(action);
  }

  private async notifyUnexpectedExit(label: string): Promise<void> {
    if (this.failureNotificationShown || this.disposed) {
      return;
    }
    this.failureNotificationShown = true;
    const action = await vscode.window.showErrorMessage(
      `Xenon Language Server for ${label} exited unexpectedly. See output or restart all servers.`,
      RESTART_SERVER,
      SHOW_OUTPUT
    );
    if (action === RESTART_SERVER) {
      await vscode.commands.executeCommand("xenon.restartLanguageServer");
    } else {
      await this.handleFailureAction(action);
    }
  }

  private async handleFailureAction(action: string | undefined): Promise<void> {
    if (action === OPEN_SETTINGS) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:zemmezzer.xenon xenon.executablePath"
      );
    } else if (action === SHOW_OUTPUT) {
      this.showOutput();
    }
  }
}
