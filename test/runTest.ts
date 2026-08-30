import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests
} from "@vscode/test-electron";

interface Scenario {
  readonly name: string;
  readonly openPath: string;
  readonly paths: Record<string, string>;
  readonly usePathResolution: boolean;
}

export async function main(): Promise<void> {
  const executable = process.env.XENON_TEST_EXECUTABLE;
  if (executable === undefined || executable.trim().length === 0) {
    throw new Error("Set XENON_TEST_EXECUTABLE to an absolute Xenon CLI path before running integration tests.");
  }

  const integrationRoot = resolve(".vscode-test", "integration-workspaces");
  await mkdir(integrationRoot, { recursive: true });
  const testRoot = await mkdtemp(join(integrationRoot, "run-"));
  const installed = process.env.XENON_TEST_INSTALLED === "1";
  const installedEnvironment = installed ? await installVsix(testRoot) : undefined;
  const allScenarios = [
    await createWorkspaceDiscoveryScenario(testRoot),
    await createProjectScenario(testRoot, executable),
    await createLooseScenario(testRoot),
    await createOutsideWorkspaceScenario(testRoot, executable),
    await createMultiRootScenario(testRoot, executable),
    await createNestedTopologyScenario(testRoot, executable)
  ];
  const onlyScenario = process.env.XENON_TEST_ONLY_SCENARIO;
  const scenarios = onlyScenario === undefined
    ? allScenarios
    : allScenarios.filter((scenario) => scenario.name === onlyScenario);
  if (scenarios.length === 0) {
    throw new Error(`Unknown requested integration scenario '${String(onlyScenario)}'.`);
  }

  for (const scenario of scenarios) {
    const inheritedPath = process.env.PATH ?? "";
    const testPath = scenario.usePathResolution
      ? `${dirname(executable)}${delimiter}${inheritedPath}`
      : inheritedPath;
    await runTests({
      ...(installedEnvironment === undefined
        ? {}
        : { vscodeExecutablePath: installedEnvironment.vscodeExecutablePath }),
      extensionDevelopmentPath: installedEnvironment?.harnessPath ?? resolve(__dirname, ".."),
      extensionTestsPath: resolve(__dirname, "suite", "index"),
      extensionTestsEnv: {
        PATH: testPath,
        XENON_TEST_SCENARIO: scenario.name,
        XENON_TEST_EXECUTABLE: executable,
        XENON_TEST_PATHS: JSON.stringify(scenario.paths)
      },
      launchArgs: installedEnvironment === undefined
        ? [scenario.openPath, "--disable-extensions"]
        : [
            scenario.openPath,
            "--extensions-dir", installedEnvironment.extensionsPath,
            "--user-data-dir", join(testRoot, `user-data-${scenario.name}`)
          ]
    });
  }
}

interface InstalledEnvironment {
  readonly vscodeExecutablePath: string;
  readonly extensionsPath: string;
  readonly harnessPath: string;
}

async function installVsix(testRoot: string): Promise<InstalledEnvironment> {
  const version = process.env.XENON_TEST_VSCODE_VERSION ?? "1.135.0";
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
  const extensionsPath = join(testRoot, "installed-extensions");
  const userDataPath = join(testRoot, "install-user-data");
  const harnessPath = join(testRoot, "installed-test-harness");
  await mkdir(extensionsPath, { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await mkdir(harnessPath, { recursive: true });
  await writeFile(join(harnessPath, "package.json"), JSON.stringify({
    name: "xenon-installed-test-harness",
    displayName: "Xenon Installed Test Harness",
    version: "0.0.0",
    publisher: "xenon-tests",
    engines: { vscode: "^1.96.0" }
  }, undefined, 2), "utf8");

  const vsix = resolve(process.env.XENON_TEST_VSIX ?? "xenon-0.1.0.vsix");
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  if (cli === undefined) {
    throw new Error("Could not resolve the VS Code command-line launcher.");
  }
  await runCommand(cli, [
    ...cliArgs,
    "--install-extension", vsix,
    "--force",
    "--extensions-dir", extensionsPath,
    "--user-data-dir", userDataPath
  ]);

  return { vscodeExecutablePath, extensionsPath, harnessPath };
}

async function runCommand(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Command '${command}' exited with code ${String(code)}.`));
      }
    });
  });
}

async function createWorkspaceDiscoveryScenario(testRoot: string): Promise<Scenario> {
  const root = join(testRoot, "TestWorkspace");
  const coreDirectory = join(root, "Core");
  const appDirectory = join(root, "App");
  const coreSource = join(coreDirectory, "src", "Core.xe");
  const appSource = join(appDirectory, "src", "Main.xe");
  await writeFiles({
    [join(root, "Test.xws")]: `[workspace]\nname = "Test Workspace"\nprojects = [\n    "Core/Core.xeproj",\n    "App/App.xeproj",\n]\n`,
    [join(coreDirectory, "Core.xeproj")]: projectFile("Core", "static-library"),
    [join(appDirectory, "App.xeproj")]: `${projectFile("App", "executable")}\n[references]\nprojects = ["../Core/Core.xeproj"]\n`,
    [coreSource]: "namespace Core;\npublic int SharedValue() { return 41; }\n",
    [appSource]: "using Core;\nnamespace App;\nint Main() { return SharedValue(); }\n"
  });
  return {
    name: "xws",
    openPath: root,
    paths: { root, coreSource, appSource },
    usePathResolution: true
  };
}

async function createProjectScenario(testRoot: string, executable: string): Promise<Scenario> {
  const root = join(testRoot, "SingleProject");
  const source = join(root, "src", "Main.xe");
  await writeFiles({
    [join(root, "Single.xeproj")]: projectFile("Single", "executable"),
    [source]: "namespace Single;\nint Helper() { return 42; }\nint Main() { return Helper(); }\n",
    [join(root, ".vscode", "settings.json")]: JSON.stringify({ "xenon.executablePath": executable }, undefined, 2)
  });
  return {
    name: "xeproj",
    openPath: root,
    paths: { root, source },
    usePathResolution: false
  };
}

async function createLooseScenario(testRoot: string): Promise<Scenario> {
  const source = join(testRoot, "Standalone", "Loose.xe");
  await writeFiles({
    [source]: "int Main()\n{\n    int looseValue = 42;\n    return looseValue;\n}\n"
  });
  return {
    name: "loose",
    openPath: source,
    paths: { source },
    usePathResolution: true
  };
}

async function createOutsideWorkspaceScenario(testRoot: string, executable: string): Promise<Scenario> {
  const root = join(testRoot, "ExternalRoutingProject");
  const projectSource = join(root, "src", "Main.xe");
  const looseSource = join(testRoot, "ExternalLoose", "Loose.xe");
  await writeFiles({
    [join(root, "ExternalRouting.xeproj")]: projectFile("ExternalRouting", "executable"),
    [join(root, ".vscode", "settings.json")]: JSON.stringify({ "xenon.executablePath": executable }, undefined, 2),
    [projectSource]: "namespace ProjectDomain;\nint ProjectOnly() { return 77; }\nint Main() { return ProjectOnly(); }\n",
    [looseSource]: "int Main()\n{\n    int looseValue = 42;\n    ProjectOnly();\n    return looseValue;\n}\n"
  });
  return {
    name: "outside-workspace",
    openPath: root,
    paths: { root, projectSource, looseSource },
    usePathResolution: false
  };
}

async function createMultiRootScenario(testRoot: string, executable: string): Promise<Scenario> {
  const projectA = join(testRoot, "ProjectA");
  const projectB = join(testRoot, "ProjectB");
  const aLibrary = join(projectA, "src", "Library.xe");
  const aMain = join(projectA, "src", "Main.xe");
  const bLibrary = join(projectB, "src", "Library.xe");
  const bMain = join(projectB, "src", "Main.xe");
  const looseSource = join(testRoot, "MultiRootLoose.xe");
  const workspaceFile = join(testRoot, "MultiRoot.code-workspace");
  await writeFiles({
    [join(projectA, "A.xws")]: `[workspace]\nname = "Workspace A"\nprojects = ["A.xeproj"]\n`,
    [join(projectA, "A.xeproj")]: projectFile("ProjectA", "executable"),
    [aLibrary]: "namespace Alpha;\npublic int OnlyA() { return 101; }\n",
    [aMain]: "using Alpha;\nnamespace AlphaApp;\nint Main() { return OnlyA(); }\n",
    [join(projectB, "B.xws")]: `[workspace]\nname = "Workspace B"\nprojects = ["B.xeproj"]\n`,
    [join(projectB, "B.xeproj")]: projectFile("ProjectB", "executable"),
    [bLibrary]: "namespace Beta;\npublic int OnlyB() { return 202; }\n",
    [bMain]: "using Beta;\nnamespace BetaApp;\nint Main() { int bLocal = OnlyB(); return bLocal; }\n",
    [looseSource]: "int Main() { int outsideValue = 303; return outsideValue; }\n",
    [workspaceFile]: JSON.stringify({
      folders: [
        { name: "ProjectA", path: projectA },
        { name: "ProjectB", path: projectB }
      ],
      settings: { "xenon.executablePath": executable }
    }, undefined, 2)
  });
  return {
    name: "multi-root",
    openPath: workspaceFile,
    paths: {
      projectA,
      projectB,
      aWorkspace: join(projectA, "A.xws"),
      bWorkspace: join(projectB, "B.xws"),
      aProject: join(projectA, "A.xeproj"),
      bProject: join(projectB, "B.xeproj"),
      aLibrary,
      aMain,
      bLibrary,
      bMain,
      looseSource
    },
    usePathResolution: false
  };
}

async function createNestedTopologyScenario(testRoot: string, executable: string): Promise<Scenario> {
  const parentRoot = join(testRoot, "NestedRepo");
  const nestedRoot = join(parentRoot, "Nested");
  const parentSource = join(parentRoot, "src", "Main.xe");
  const nestedSource = join(nestedRoot, "src", "Main.xe");
  const workspaceFile = join(testRoot, "NestedTopology.code-workspace");
  await writeFiles({
    [join(parentRoot, "Parent.xeproj")]: projectFile("Parent", "executable"),
    [parentSource]: "namespace ParentDomain;\nint ParentOnly() { return 11; }\nint Main() { return ParentOnly(); }\n",
    [join(nestedRoot, "Nested.xeproj")]: projectFile("Nested", "executable"),
    [nestedSource]: "namespace NestedDomain;\nint NestedOnly() { return 22; }\nint Main() { int nestedLocal = NestedOnly(); return nestedLocal; }\n",
    [workspaceFile]: JSON.stringify({
      folders: [
        { name: "Parent", path: parentRoot },
        { name: "Nested", path: nestedRoot }
      ],
      settings: { "xenon.executablePath": executable }
    }, undefined, 2)
  });
  return {
    name: "nested-topology",
    openPath: workspaceFile,
    paths: { parentRoot, nestedRoot, parentSource, nestedSource },
    usePathResolution: false
  };
}

function projectFile(name: string, type: "executable" | "static-library"): string {
  return `[project]\nname = "${name}"\ntype = "${type}"\n\n[source]\nroot = "src"\n`;
}

async function writeFiles(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}
