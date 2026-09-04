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
    readonly semanticTokenScopes: readonly {
      readonly language: string;
      readonly scopes: Readonly<Record<string, readonly string[]>>;
    }[];
    readonly commands: readonly { readonly command: string }[];
    readonly configuration: {
      readonly properties: Readonly<Record<string, { readonly type: string; readonly default: unknown }>>;
    };
  };
}

interface GrammarRule {
  readonly name?: string;
  readonly match?: string;
  readonly begin?: string;
  readonly beginCaptures?: Readonly<Record<string, { readonly name?: string }>>;
  readonly end?: string;
  readonly include?: string;
  readonly patterns?: readonly GrammarRule[];
}

test("extension manifest wires the production bundle and required contributions", () => {
  const manifest = readJson<ExtensionManifest>("package.json");
  assert.equal(manifest.name, "xenon");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.publisher, "zem");
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

  const xenonProject = manifest.contributes.languages.find((language) => language.id === "xenon-project");
  assert.ok(xenonProject);
  assert.deepEqual(xenonProject.extensions, [".xeproj"]);
  assert.deepEqual(xenonProject.icon, xenon.icon);

  const xenonWorkspace = manifest.contributes.languages.find((language) => language.id === "xenon-workspace");
  assert.ok(xenonWorkspace);
  assert.deepEqual(xenonWorkspace.extensions, [".xws"]);
  assert.deepEqual(xenonWorkspace.icon, xenon.icon);

  assert.ok(manifest.contributes.grammars.some((grammar) =>
    grammar.language === "xenon" && grammar.path === "./syntaxes/xenon.tmLanguage.json"));
  const semanticScopes = manifest.contributes.semanticTokenScopes.find((entry) =>
    entry.language === "xenon")?.scopes;
  assert.deepEqual(semanticScopes, {
    modifier: ["storage.modifier.declaration.xenon"],
    controlKeyword: ["storage.modifier.control.xenon"],
    declarationKeyword: ["storage.modifier.declaration.xenon"],
    expressionKeyword: ["storage.modifier.expression.xenon"],
    baseTypeKeyword: ["storage.modifier.base-types.xenon"],
    literalKeyword: ["storage.modifier.literal.xenon"],
    typeKeyword: ["storage.modifier.type-forming.xenon"],
    valueKeyword: ["storage.modifier.value-forming.xenon"],
    lifetimeOperation: ["storage.modifier.lifetime.xenon"]
  });
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

  const grammar = readJson<{
    readonly scopeName: string;
    readonly repository: Readonly<Record<string, GrammarRule>>;
  }>("syntaxes/xenon.tmLanguage.json");
  assert.equal(grammar.scopeName, "source.xenon");
  const baseTypes = grammar.repository["types"];
  assert.equal(baseTypes?.name, "storage.modifier.base-types.xenon");
  const baseTypePattern = new RegExp(baseTypes?.match ?? "(?!)");
  for (const type of [
    "void", "bool", "byte", "sbyte", "short", "ushort", "int", "uint", "long", "ulong",
    "float", "double", "nint", "nuint", "clong", "culong"
  ])
    assert.match(type, baseTypePattern);

  const literalKeywords = grammar.repository["language-constants"];
  assert.equal(literalKeywords?.name, "storage.modifier.literal.xenon");
  const literalKeywordPattern = new RegExp(literalKeywords?.match ?? "(?!)");
  for (const keyword of ["true", "false", "null"])
    assert.match(keyword, literalKeywordPattern);

  const expressionKeywords = grammar.repository["expression-keywords"];
  assert.equal(expressionKeywords?.name, "storage.modifier.expression.xenon");
  const expressionPattern = new RegExp(expressionKeywords?.match ?? "(?!)");
  for (const keyword of ["this", "base", "get", "set", "sizeof", "alignof", "offsetof", "cast", "bitcast"])
    assert.match(keyword, expressionPattern);

  const typeFormingKeywords = grammar.repository["type-forming-keywords"];
  assert.equal(typeFormingKeywords?.name, "storage.modifier.type-forming.xenon");
  const typeFormingPattern = new RegExp(typeFormingKeywords?.match ?? "(?!)");
  for (const typeForm of [
    "unique<Resource>", "shared<Resource>", "weak<Resource>", "storage<Resource>",
    "pin<Resource>", "atomic<int>", "atomic <Snapshot>"
  ])
    assert.match(typeForm, typeFormingPattern);
  for (const identifier of ["uniquely", "sharedState", "weakness", "atomicValue"]) {
    assert.doesNotMatch(identifier, typeFormingPattern);
  }

  const modifiers = grammar.repository["modifiers"];
  assert.equal(modifiers?.name, "storage.modifier.declaration.xenon");
  const modifierPattern = new RegExp(modifiers?.match ?? "(?!)");
  assert.match("threadlocal", modifierPattern);
  assert.doesNotMatch("threadlocalValue", modifierPattern);

  const controlKeywords = grammar.repository["control-keywords"];
  assert.equal(controlKeywords?.name, "storage.modifier.control.xenon");
  const controlPattern = new RegExp(controlKeywords?.match ?? "(?!)");
  for (const keyword of [
    "switch", "case", "default", "if", "else", "while", "for", "break", "continue", "return"
  ])
    assert.match(keyword, controlPattern);

  const operators = grammar.repository["operators"];
  const operatorPattern = new RegExp(`^(?:${operators?.match ?? "(?!)"})$`);
  for (const operator of ["<->", "-->"])
    assert.match(operator, operatorPattern);

  const valueFormingKeywords = grammar.repository["value-forming-keywords"];
  assert.equal(valueFormingKeywords?.name, "storage.modifier.value-forming.xenon");
  const valueFormingPattern = new RegExp(valueFormingKeywords?.match ?? "(?!)");
  for (const keyword of ["new", "move", "lock"])
    assert.match(keyword, valueFormingPattern);

  const lifetimeOperations = grammar.repository["lifetime-operation-keywords"];
  assert.equal(lifetimeOperations?.name, "storage.modifier.lifetime.xenon");
  const lifetimeOperationPattern = new RegExp(lifetimeOperations?.match ?? "(?!)");
  for (const keyword of ["free", "destruct"])
    assert.match(keyword, lifetimeOperationPattern);
  const declarationPatterns = grammar.repository["declaration-keywords"]?.patterns ?? [];
  assert.ok(declarationPatterns.every(pattern => pattern.name?.startsWith("storage.modifier.declaration.")));
  const declarationPattern = new RegExp(declarationPatterns
    .find((pattern) => pattern.name === "storage.modifier.declaration.type.xenon")?.match ?? "(?!)");
  const constraintPattern = new RegExp(declarationPatterns
    .find((pattern) => pattern.name === "storage.modifier.declaration.constraint.xenon")?.match ?? "(?!)");
  assert.match("template", declarationPattern);
  assert.doesNotMatch("set", declarationPattern);
  assert.match("where", constraintPattern);

  const genericTypes = grammar.repository["generic-types"];
  assert.equal(genericTypes?.name, "entity.name.type.struct.xenon");
  assert.match("List<int>", new RegExp(genericTypes?.match ?? "(?!)"));

  const contextual = grammar.repository["contextual-identifiers"]?.patterns ?? [];
  const thisRule = contextual.find((pattern) => pattern.name === "storage.modifier.expression.xenon");
  assert.match("this", new RegExp(thisRule?.match ?? "(?!)"));
  const setter = contextual.find((pattern) => pattern.name === "meta.accessor.setter.xenon");
  assert.match("set {", new RegExp(setter?.begin ?? "(?!)"));
  assert.equal(setter?.beginCaptures?.["1"]?.name, "storage.modifier.expression.xenon");
  const setterValue = setter?.patterns?.find(
    (pattern) => pattern.name === "storage.modifier.contextual-value.xenon");
  assert.match("value", new RegExp(setterValue?.match ?? "(?!)"));
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

test("README describes current relocation, move effect, and reference lifetime semantics", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /relocation/i);
  assert.match(readme, /Ordinary arrays can be moved/);
  assert.match(readme, /callee-stack-backed/);
  assert.doesNotMatch(readme, /ordinary array move is deferred/i);
  assert.match(readme, /Every reachable exit must agree/);
  assert.match(readme, /interface\/virtual dispatch cannot hide a move effect/);
  assert.match(readme, /final resolved implementation/);
  assert.match(readme, /inherited and multi-level interface implementations/);
  assert.match(readme, /passing a local, its field, a by-value parameter, or a temporary through one or more forwarding calls cannot make it escape safely/);
  assert.match(readme, /Reference-return provenance is composed transitively/);
  assert.match(readme, /Ownership wrappers support struct, array, and primitive pointees/);
  assert.match(readme, /cannot bypass a private destructor/);
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
