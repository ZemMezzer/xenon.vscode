import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

interface ExtensionManifest {
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly license: string;
  readonly icon: string;
  readonly repository: { readonly type: string; readonly url: string };
  readonly main: string;
  readonly engines: { readonly vscode: string };
  readonly activationEvents: readonly string[];
  readonly contributes: {
    readonly languages: readonly {
      readonly id: string;
      readonly extensions: readonly string[];
      readonly configuration: string;
      readonly icon: { readonly light: string; readonly dark: string };
    }[];
    readonly grammars: readonly { readonly language: string; readonly path: string }[];
    readonly commands: readonly { readonly command: string }[];
    readonly configuration: {
      readonly properties: Readonly<Record<string, { readonly type: string; readonly default: unknown }>>;
    };
  };
}

test("extension manifest wires the production bundle and required contributions", () => {
  const manifest = readJson<ExtensionManifest>("package.json");
  assert.equal(manifest.name, "xenon");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.publisher, "zemmezzer");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.icon, "resources/xenon.png");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "https://github.com/ZemMezzer/xenon.vscode.git"
  });
  assert.equal(manifest.main, "./dist/extension.js");
  assert.equal(manifest.engines.vscode, "^1.96.0");

  const xenon = manifest.contributes.languages.find((language) => language.id === "xenon");
  assert.ok(xenon);
  assert.deepEqual(xenon.extensions, [".xe"]);
  assert.equal(xenon.configuration, "./language-configuration.json");
  assert.deepEqual(xenon.icon, {
    light: "./resources/xenon.png",
    dark: "./resources/xenon.png"
  });
  assert.equal(xenon.extensions.includes(".xeproj"), false);
  assert.equal(xenon.extensions.includes(".xws"), false);

  assert.ok(manifest.contributes.grammars.some((grammar) =>
    grammar.language === "xenon" && grammar.path === "./syntaxes/xenon.tmLanguage.json"));
  const commands = new Set(manifest.contributes.commands.map((command) => command.command));
  assert.ok(commands.has("xenon.restartLanguageServer"));
  assert.ok(commands.has("xenon.showLanguageServerOutput"));

  const executablePath = manifest.contributes.configuration.properties["xenon.executablePath"];
  assert.deepEqual(executablePath, {
    type: "string",
    default: "",
    scope: "machine-overridable",
    description: "Absolute path to the Xenon executable. Leave empty to use 'xenon' from PATH."
  });
  assert.ok(manifest.activationEvents.includes("onLanguage:xenon"));
  assert.ok(manifest.activationEvents.includes("workspaceContains:**/*.xe"));
  assert.ok(manifest.activationEvents.includes("workspaceContains:**/*.xeproj"));
  assert.ok(manifest.activationEvents.includes("workspaceContains:**/*.xws"));
  assert.ok(manifest.activationEvents.includes("onCommand:xenon.restartLanguageServer"));
  assert.ok(manifest.activationEvents.includes("onCommand:xenon.showLanguageServerOutput"));
});

test("language configuration and TextMate grammar remain valid JSON with actual Xenon delimiters", () => {
  const configuration = readJson<{
    readonly comments: { readonly lineComment: string; readonly blockComment: readonly string[] };
    readonly brackets: readonly (readonly string[])[];
    readonly autoClosingPairs: readonly { readonly open: string; readonly close: string }[];
    readonly surroundingPairs: readonly (readonly string[])[];
    readonly indentationRules: Readonly<Record<string, string>>;
    readonly wordPattern: string;
  }>("language-configuration.json");
  assert.equal(configuration.comments.lineComment, "//");
  assert.deepEqual(configuration.comments.blockComment, ["/*", "*/"]);
  assert.deepEqual(configuration.brackets, [["{", "}"], ["[", "]"], ["(", ")"]]);
  assert.deepEqual(configuration.autoClosingPairs, [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "\"", close: "\"", notIn: ["string", "comment"] },
    { open: "/*", close: " */", notIn: ["string"] }
  ]);
  assert.deepEqual(configuration.surroundingPairs, [
    ["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""]
  ]);
  assert.ok(configuration.indentationRules.increaseIndentPattern);
  assert.ok(configuration.indentationRules.decreaseIndentPattern);
  assert.ok(configuration.wordPattern.length > 0);
  assert.doesNotThrow(() => new RegExp(configuration.indentationRules.increaseIndentPattern));
  assert.doesNotThrow(() => new RegExp(configuration.indentationRules.decreaseIndentPattern));
  assert.doesNotThrow(() => new RegExp(configuration.wordPattern));

  const grammar = readJson<{ readonly scopeName: string }>("syntaxes/xenon.tmLanguage.json");
  assert.equal(grammar.scopeName, "source.xenon");
});

test("release root metadata and packaging exclusions are internally consistent", () => {
  for (const path of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "language-configuration.json",
    ".vscodeignore",
    "README.md",
    "LICENSE"
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist at the project root`);
  }

  const manifest = readJson<ExtensionManifest>("package.json");
  const lock = readJson<{
    readonly name: string;
    readonly version: string;
    readonly lockfileVersion: number;
    readonly packages: Readonly<Record<string, {
      readonly license?: string;
      readonly dependencies?: Readonly<Record<string, string>>;
    }>>;
  }>("package-lock.json");
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[""]?.license, manifest.license);
  assert.equal(lock.packages[""]?.dependencies?.["vscode-languageclient"], "^9.0.1");

  const ignore = readFileSync(".vscodeignore", "utf8");
  for (const exclusion of [
    "src/**",
    "test/**",
    "node_modules/**",
    "dist-test/**",
    "coverage/**",
    "**/*.map",
    "package-lock.json",
    "tsconfig.json"
  ]) {
    assert.ok(ignore.split(/\r?\n/).includes(exclusion), `${exclusion} must be excluded from VSIX`);
  }
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
