import assert from "node:assert/strict";
import test from "node:test";
import {
  isOutsideWorkspaceXenonDocument,
  isXenonFileDocument,
  needsStandaloneClient,
  type RoutableDocument
} from "../../src/routing";

interface TestDocument extends RoutableDocument {
  readonly path: string;
}

const externalXenon: TestDocument = {
  languageId: "xenon",
  uri: { scheme: "file" },
  path: "C:/Temp/Loose.xe"
};

test("standalone routing accepts only file-based Xenon documents without a workspace owner", () => {
  assert.equal(isXenonFileDocument(externalXenon), true);
  assert.equal(isOutsideWorkspaceXenonDocument(externalXenon, () => false), true);
  assert.equal(isOutsideWorkspaceXenonDocument(externalXenon, () => true), false);
  assert.equal(isXenonFileDocument({ ...externalXenon, languageId: "plaintext" }), false);
  assert.equal(isXenonFileDocument({ ...externalXenon, uri: { scheme: "untitled" } }), false);
});

test("standalone lifecycle is needed exactly while an outside-workspace Xenon document is open", () => {
  const folderDocument: TestDocument = { ...externalXenon, path: "C:/Project/Main.xe" };
  const plainDocument: TestDocument = { ...externalXenon, languageId: "plaintext", path: "C:/Temp/Notes.txt" };
  const hasWorkspaceFolder = (document: TestDocument): boolean => document.path.startsWith("C:/Project/");

  assert.equal(needsStandaloneClient([], hasWorkspaceFolder), false);
  assert.equal(needsStandaloneClient([folderDocument, plainDocument], hasWorkspaceFolder), false);
  assert.equal(needsStandaloneClient([folderDocument, externalXenon], hasWorkspaceFolder), true);
});
