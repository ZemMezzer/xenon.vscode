import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { XenonLanguageClientManager } from "./languageClient";
import { RestartScheduler } from "./restartScheduler";

let manager: XenonLanguageClientManager | undefined;
const TEST_TARGETS_COMMAND = "xenon.test.getClientTargets";
const TEST_TOPOLOGY_COMMAND = "xenon.test.getTopologySnapshot";
const TEST_OWNERS_COMMAND = "xenon.test.getDocumentOwners";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Xenon Language Server");
  manager = new XenonLanguageClientManager(output);
  const restarts = new RestartScheduler((reason) => manager?.restart(reason) ?? Promise.resolve());

  context.subscriptions.push(output, manager);
  registerCommands(context, manager, restarts);
  if (process.env.XENON_TEST_SCENARIO !== undefined) {
    context.subscriptions.push(vscode.commands.registerCommand(
      TEST_TARGETS_COMMAND,
      () => manager?.getActiveTargetKeys() ?? Promise.resolve([])
    ), vscode.commands.registerCommand(
      TEST_TOPOLOGY_COMMAND,
      () => manager?.getTopologySnapshot()
    ), vscode.commands.registerCommand(
      TEST_OWNERS_COMMAND,
      (uri: vscode.Uri) => manager?.getDocumentOwnerKeys(uri) ?? Promise.resolve([])
    ));
  }

  const reconcileDocumentLifecycle = (document: vscode.TextDocument, reason: string): void => {
    if (document.languageId === "xenon" && document.uri.scheme === "file") {
      void manager?.refreshWorkspaceFolders(reason);
    }
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void manager?.rebuildWorkspaceTopology("VS Code workspace folders changed");
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      reconcileDocumentLifecycle(document, "Xenon document opened");
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === "xenon" && document.uri.scheme === "file") {
        void manager?.refreshWorkspaceFolders("Xenon document closed");
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("xenon.executablePath")) {
        void restarts.request("xenon.executablePath changed");
      }
    })
  );

  await manager.start();
}

export async function deactivate(): Promise<void> {
  const activeManager = manager;
  manager = undefined;
  await activeManager?.disposeAsync();
}
