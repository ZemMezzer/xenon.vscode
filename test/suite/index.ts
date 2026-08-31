import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "zem.xenon";
const scenario = process.env.XENON_TEST_SCENARIO;
interface TestPaths {
  readonly root: string;
  readonly source: string;
  readonly coreSource: string;
  readonly appSource: string;
  readonly projectA: string;
  readonly projectB: string;
  readonly aWorkspace: string;
  readonly bWorkspace: string;
  readonly aProject: string;
  readonly bProject: string;
  readonly aLibrary: string;
  readonly aMain: string;
  readonly bLibrary: string;
  readonly bMain: string;
  readonly projectSource: string;
  readonly looseSource: string;
  readonly parentRoot: string;
  readonly nestedRoot: string;
  readonly parentSource: string;
  readonly nestedSource: string;
}
interface TopologySnapshot {
  readonly generation: number;
  readonly clients: readonly {
    readonly key: string;
    readonly instanceId: string;
    readonly watcherCount: number;
  }[];
}
const paths = JSON.parse(process.env.XENON_TEST_PATHS ?? "{}") as TestPaths;

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} must be installed in the Extension Development Host`);
  await extension.activate();
  assert.equal(extension.isActive, true, "extension must activate");

  switch (scenario) {
    case "xws":
      await testWorkspaceDiscovery();
      break;
    case "xeproj":
      await testProjectDiscovery();
      break;
    case "loose":
      await testLooseFile();
      break;
    case "outside-workspace":
      await testOutsideWorkspaceLooseFile();
      break;
    case "multi-root":
      await testMultiRoot();
      break;
    case "nested-topology":
      await testNestedTopology();
      break;
    default:
      throw new Error(`Unknown integration scenario '${scenario}'.`);
  }
}

async function testWorkspaceDiscovery(): Promise<void> {
  assert.equal(vscode.workspace.getConfiguration("xenon").get<string>("executablePath"), "");
  const app = await openXenon(paths.appSource);
  const definitions = await waitForDefinitions(app, positionOf(app, "SharedValue"));
  assertDefinitionTargets(definitions, paths.coreSource, paths.root);
}

async function testProjectDiscovery(): Promise<void> {
  const document = await openXenon(paths.source);
  const definitions = await waitForDefinitions(document, positionOf(document, "Helper", true));
  assertDefinitionTargets(definitions, paths.source, paths.root);
}

async function testLooseFile(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders, undefined, "standalone file must not require a workspace folder");
  const document = await openXenon(paths.source);
  const hovers = await waitForHover(document, positionOf(document, "looseValue", true));
  assert.ok(hovers.length > 0, "standalone loose file must receive semantic tooling");
}

async function testOutsideWorkspaceLooseFile(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders?.length, 1, "project workspace must remain open");
  const project = await openXenon(paths.projectSource);
  const projectDefinitions = await waitForDefinitions(project, positionOf(project, "ProjectOnly", true));
  assertDefinitionTargets(projectDefinitions, paths.projectSource, paths.root);
  await waitForClientTargets(1, false);
  await assertSingleOwner(project, folderKey(paths.root));

  const loose = await openXenon(paths.looseSource);
  assert.equal(vscode.workspace.getWorkspaceFolder(loose.uri), undefined, "loose file must be outside the workspace");
  const hovers = await waitForHover(loose, positionOf(loose, "looseValue", true));
  assert.ok(hovers.length > 0, "outside-workspace loose file must receive semantic tooling");
  await waitForClientTargets(2, true);
  await assertSingleOwner(loose, "standalone");

  const leakedDefinitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    "vscode.executeDefinitionProvider",
    loose.uri,
    positionOf(loose, "ProjectOnly")
  );
  assert.equal(leakedDefinitions?.length ?? 0, 0, "folder symbols must not resolve in the loose-file client");
  await assertWorkspaceSymbolCount("ProjectOnly", paths.root, 1);

  await vscode.window.showTextDocument(loose);
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await waitForEditorClosed(loose.uri);
  await waitForClientTargets(2, true);
  await assertRootDefinitions(project, "ProjectOnly", paths.projectSource, paths.root, paths.looseSource);
  await assertWorkspaceSymbolCount("ProjectOnly", paths.root, 1);
}

async function testMultiRoot(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders?.length, 2, "multi-root workspace must expose both roots");
  const documentA = await openXenon(paths.aMain);
  const documentB = await openXenon(paths.bMain);

  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  await assertWorkspaceSymbolIsolation("OnlyA", paths.projectA, paths.projectB);
  await assertWorkspaceSymbolIsolation("OnlyB", paths.projectB, paths.projectA);
  await waitForClientTargets(2, false);
  await assertSingleOwner(documentA, folderKey(paths.projectA));
  await assertSingleOwner(documentB, folderKey(paths.projectB));

  const loose = await openXenon(paths.looseSource);
  assert.equal(vscode.workspace.getWorkspaceFolder(loose.uri), undefined);
  const looseHovers = await waitForHover(loose, positionOf(loose, "outsideValue", true));
  assert.ok(looseHovers.length > 0, "multi-root external loose file must receive semantic tooling");
  await waitForClientTargets(3, true);
  await assertSingleOwner(loose, "standalone");
  await assertWorkspaceSymbolCount("OnlyA", paths.projectA, 1);
  await assertWorkspaceSymbolCount("OnlyB", paths.projectB, 1);
  await appendNewline(paths.aLibrary);
  await delay(750);
  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  await appendNewline(paths.aProject);
  await delay(750);
  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  await appendNewline(paths.aWorkspace);
  await delay(750);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  await appendNewline(paths.bWorkspace);
  await delay(750);
  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);

  const beforeRestart = await getTopologySnapshot();
  await vscode.commands.executeCommand("xenon.restartLanguageServer");
  const afterRestart = await waitForRebuiltTopology(beforeRestart, 3, true);
  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  assertWatcherTopology(afterRestart);

  const executable = process.env.XENON_TEST_EXECUTABLE;
  assert.ok(executable);
  const alternateSeparators = executable.replaceAll("\\", "/");
  const beforeConfigurationRestart = await getTopologySnapshot();
  await vscode.workspace.getConfiguration("xenon").update(
    "executablePath",
    alternateSeparators,
    vscode.ConfigurationTarget.Workspace
  );
  const afterConfigurationRestart = await waitForRebuiltTopology(beforeConfigurationRestart, 3, true);
  await assertRootDefinitions(documentA, "OnlyA", paths.aLibrary, paths.projectA, paths.projectB);
  await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
  assertWatcherTopology(afterConfigurationRestart);

  let previousTopology = afterConfigurationRestart;
  for (let cycle = 1; cycle <= 2; cycle++) {
    const removed = vscode.workspace.updateWorkspaceFolders(1, 1);
    assert.equal(removed, true, `ProjectB must be removable in topology cycle ${cycle}`);
    await waitForFolderCount(1);
    const removedTopology = await waitForRebuiltTopology(previousTopology, 2, true);
    assertWatcherTopology(removedTopology);
    await assertSingleOwner(documentA, folderKey(paths.projectA));
    await assertSingleOwner(documentB, "standalone");
    await assertSingleOwner(loose, "standalone");
    const bHovers = await waitForHover(documentB, positionOf(documentB, "bLocal", true));
    assert.ok(bHovers.length > 0, "ProjectB document must retain loose semantic tooling after removal");
    await assertNoWorkspaceSymbol("OnlyB", paths.projectB);

    const added = vscode.workspace.updateWorkspaceFolders(1, 0, {
      name: "ProjectB",
      uri: vscode.Uri.file(paths.projectB)
    });
    assert.equal(added, true, `ProjectB must be re-addable in topology cycle ${cycle}`);
    await waitForFolderCount(2);
    const addedTopology = await waitForRebuiltTopology(removedTopology, 3, true);
    assertWatcherTopology(addedTopology);
    await assertSingleOwner(documentA, folderKey(paths.projectA));
    await assertSingleOwner(documentB, folderKey(paths.projectB));
    await assertSingleOwner(loose, "standalone");
    await assertRootDefinitions(documentB, "OnlyB", paths.bLibrary, paths.projectB, paths.projectA);
    await assertWorkspaceSymbolCount("OnlyB", paths.projectB, 1);
    const looseAfterTopology = await waitForHover(loose, positionOf(loose, "outsideValue", true));
    assert.ok(looseAfterTopology.length > 0, "external loose file must survive folder topology rebuilds");
    previousTopology = addedTopology;
  }

  await vscode.window.showTextDocument(loose);
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await waitForEditorClosed(loose.uri);
  await waitForClientTargets(3, true);

  await vscode.commands.executeCommand("xenon.showLanguageServerOutput");
}

async function testNestedTopology(): Promise<void> {
  assert.equal(vscode.workspace.workspaceFolders?.length, 2, "nested scenario must start with two roots");
  const parent = await openXenon(paths.parentSource);
  const nested = await openXenon(paths.nestedSource);
  await waitForClientTargets(2, false);
  assert.equal(vscode.workspace.getWorkspaceFolder(nested.uri)?.uri.fsPath.toLowerCase(), paths.nestedRoot.toLowerCase());
  await assertSingleOwner(parent, folderKey(paths.parentRoot));
  await assertSingleOwner(nested, folderKey(paths.nestedRoot));
  await assertWorkspaceSymbolCount("NestedOnly", paths.nestedRoot, 1);

  const initial = await getTopologySnapshot();
  const removed = vscode.workspace.updateWorkspaceFolders(1, 1);
  assert.equal(removed, true, "nested workspace folder must be removable");
  await waitForFolderCount(1);
  const parentOwned = await waitForRebuiltTopology(initial, 1, false);
  assertWatcherTopology(parentOwned);
  assert.equal(vscode.workspace.getWorkspaceFolder(nested.uri)?.uri.fsPath.toLowerCase(), paths.parentRoot.toLowerCase());
  await assertSingleOwner(parent, folderKey(paths.parentRoot));
  await assertSingleOwner(nested, folderKey(paths.parentRoot));
  const nestedHovers = await waitForHover(nested, positionOf(nested, "nestedLocal", true));
  assert.ok(nestedHovers.length > 0, "nested document must transfer to the parent client");

  const added = vscode.workspace.updateWorkspaceFolders(1, 0, {
    name: "Nested",
    uri: vscode.Uri.file(paths.nestedRoot)
  });
  assert.equal(added, true, "nested workspace folder must be re-addable");
  await waitForFolderCount(2);
  const nestedOwned = await waitForRebuiltTopology(parentOwned, 2, false);
  assertWatcherTopology(nestedOwned);
  assert.equal(vscode.workspace.getWorkspaceFolder(nested.uri)?.uri.fsPath.toLowerCase(), paths.nestedRoot.toLowerCase());
  await assertSingleOwner(parent, folderKey(paths.parentRoot));
  await assertSingleOwner(nested, folderKey(paths.nestedRoot));
  await assertRootDefinitions(nested, "NestedOnly", paths.nestedSource, paths.nestedRoot, paths.parentSource);
  await assertWorkspaceSymbolCount("NestedOnly", paths.nestedRoot, 1);
}

async function assertRootDefinitions(
  document: vscode.TextDocument,
  symbol: string,
  expectedFile: string,
  expectedRoot: string,
  forbiddenRoot: string
): Promise<void> {
  const definitions = await waitForDefinitions(document, positionOf(document, symbol));
  assertDefinitionTargets(definitions, expectedFile, expectedRoot);
  for (const definition of definitions) {
    assert.equal(
      uriOf(definition).fsPath.toLowerCase().startsWith(forbiddenRoot.toLowerCase()),
      false,
      `${symbol} must not resolve into another root`
    );
  }
}

async function assertWorkspaceSymbolIsolation(
  query: string,
  expectedRoot: string,
  forbiddenRoot: string
): Promise<void> {
  const symbols = await waitForWorkspaceSymbols(query);
  assert.ok(
    symbols.some((symbol) => symbol.location.uri.fsPath.toLowerCase().startsWith(expectedRoot.toLowerCase())),
    `${query} must exist in its root`
  );
  assert.equal(
    symbols.some((symbol) => symbol.location.uri.fsPath.toLowerCase().startsWith(forbiddenRoot.toLowerCase())),
    false,
    `${query} must not leak into the other root`
  );
}

async function assertWorkspaceSymbolCount(query: string, expectedRoot: string, expectedCount: number): Promise<void> {
  const symbols = await waitForWorkspaceSymbols(query);
  const matching = symbols.filter((symbol) =>
    symbol.name === query && symbol.location.uri.fsPath.toLowerCase().startsWith(expectedRoot.toLowerCase()));
  assert.equal(matching.length, expectedCount, `${query} must be reported once by its owning routing domain`);
}

async function assertNoWorkspaceSymbol(query: string, forbiddenRoot: string): Promise<void> {
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query
  ) ?? [];
  assert.equal(
    symbols.some((symbol) =>
      symbol.name === query && symbol.location.uri.fsPath.toLowerCase().startsWith(forbiddenRoot.toLowerCase())),
    false,
    `${query} from retired routing domain must not remain in workspace symbols`
  );
}

async function assertSingleOwner(document: vscode.TextDocument, expectedKey: string): Promise<void> {
  await retry(async () => {
    const owners = await vscode.commands.executeCommand<readonly string[]>(
      "xenon.test.getDocumentOwners",
      document.uri
    );
    return Array.isArray(owners) && owners.length === 1 && owners[0] === expectedKey ? true : undefined;
  }, `single owner '${expectedKey}' for '${document.uri.fsPath}'`);
}

function folderKey(path: string): string {
  return vscode.Uri.file(path).toString();
}

async function getTopologySnapshot(): Promise<TopologySnapshot> {
  const snapshot = await vscode.commands.executeCommand<TopologySnapshot>("xenon.test.getTopologySnapshot");
  assert.ok(snapshot, "test topology snapshot must be available");
  return snapshot;
}

async function waitForRebuiltTopology(
  previous: TopologySnapshot,
  clientCount: number,
  standalone: boolean
): Promise<TopologySnapshot> {
  const previousIds = new Set(previous.clients.map((client) => client.instanceId));
  return retry(async () => {
    const snapshot = await vscode.commands.executeCommand<TopologySnapshot>("xenon.test.getTopologySnapshot");
    if (snapshot === undefined || snapshot.generation <= previous.generation ||
        snapshot.clients.length !== clientCount ||
        snapshot.clients.some((client) => previousIds.has(client.instanceId)) ||
        snapshot.clients.some((client) => client.key === "standalone") !== standalone) {
      return undefined;
    }
    return snapshot;
  }, `rebuilt topology generation after ${previous.generation}`);
}

function assertWatcherTopology(snapshot: TopologySnapshot): void {
  for (const client of snapshot.clients) {
    assert.equal(
      client.watcherCount,
      client.key === "standalone" ? 0 : 3,
      `${client.key} must have the expected watcher count`
    );
  }
}

async function openXenon(path: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  assert.equal(document.languageId, "xenon", ".xe files must use the Xenon language ID");
  await vscode.window.showTextDocument(document);
  return document;
}

function positionOf(document: vscode.TextDocument, text: string, last = false): vscode.Position {
  const source = document.getText();
  const index = last ? source.lastIndexOf(text) : source.indexOf(text);
  assert.notEqual(index, -1, `Test source must contain '${text}'`);
  return document.positionAt(index + 1);
}

async function waitForDefinitions(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<readonly (vscode.Location | vscode.LocationLink)[]> {
  return retry(async () => {
    const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      "vscode.executeDefinitionProvider",
      document.uri,
      position
    );
    return Array.isArray(definitions) && definitions.length > 0 ? definitions : undefined;
  }, "definition");
}

async function waitForHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover[]> {
  return retry(async () => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      position
    );
    return Array.isArray(hovers) && hovers.length > 0 ? hovers : undefined;
  }, "hover");
}

async function waitForWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
  return retry(async () => {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    );
    return Array.isArray(symbols) && symbols.length > 0 ? symbols : undefined;
  }, `workspace symbol '${query}'`);
}

function assertDefinitionTargets(
  definitions: readonly (vscode.Location | vscode.LocationLink)[],
  expectedFile: string,
  expectedRoot: string
): void {
  const actualPaths = definitions.map((definition) => uriOf(definition).fsPath);
  assert.ok(
    actualPaths.some((path) => path.toLowerCase() === expectedFile.toLowerCase()),
    `Expected definition '${expectedFile}', received: ${actualPaths.join(", ")}`
  );
  assert.ok(
    actualPaths.every((path) => path.toLowerCase().startsWith(expectedRoot.toLowerCase())),
    `Definitions escaped '${expectedRoot}': ${actualPaths.join(", ")}`
  );
}

function uriOf(definition: vscode.Location | vscode.LocationLink): vscode.Uri {
  return "uri" in definition ? definition.uri : definition.targetUri;
}

async function appendNewline(path: string): Promise<void> {
  const uri = vscode.Uri.file(path);
  const content = await vscode.workspace.fs.readFile(uri);
  const next = new Uint8Array(content.length + 1);
  next.set(content);
  next[content.length] = 10;
  await vscode.workspace.fs.writeFile(uri, next);
}

async function waitForFolderCount(count: number): Promise<void> {
  await retry(async () => vscode.workspace.workspaceFolders?.length === count ? true : undefined, `folder count ${count}`);
}

async function waitForClientTargets(count: number, standalone: boolean): Promise<readonly string[]> {
  return retry(async () => {
    const targets = await vscode.commands.executeCommand<readonly string[]>("xenon.test.getClientTargets");
    return Array.isArray(targets) && targets.length === count && targets.includes("standalone") === standalone
      ? targets
      : undefined;
  }, `${count} client target(s), standalone=${standalone}`);
}

async function waitForEditorClosed(uri: vscode.Uri): Promise<void> {
  await retry(async () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === uri.toString())
    ? undefined
    : true, `editor '${uri.fsPath}' to close`);
}

async function retry<T>(operation: () => Promise<T | undefined>, description: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result !== undefined) {
        return result;
      }
    } catch (error: unknown) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}. Last error: ${String(lastError)}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
