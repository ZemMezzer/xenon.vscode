import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStartupFailure,
  DEFAULT_EXECUTABLE,
  selectExecutable
} from "../../src/executable";

test("configured executable takes precedence without shell composition", () => {
  assert.deepEqual(selectExecutable("  C:\\Tools\\Xenon\\xenon.exe  "), {
    command: "C:\\Tools\\Xenon\\xenon.exe",
    source: "configuration"
  });
});

test("Unix executable paths are preserved exactly", () => {
  assert.deepEqual(selectExecutable("/usr/local/bin/xenon"), {
    command: "/usr/local/bin/xenon",
    source: "configuration"
  });
});

test("empty or invalid configuration falls back to xenon from PATH", () => {
  assert.deepEqual(selectExecutable("   "), { command: DEFAULT_EXECUTABLE, source: "path" });
  assert.deepEqual(selectExecutable(undefined), { command: DEFAULT_EXECUTABLE, source: "path" });
});

test("startup errors are classified for actionable UX", () => {
  assert.equal(classifyStartupFailure(Object.assign(new Error("spawn failed"), { code: "ENOENT" })), "not-found");
  assert.equal(classifyStartupFailure(Object.assign(new Error("spawn failed"), { code: "EACCES" })), "permission-denied");
  assert.equal(classifyStartupFailure(new Error("server exited with code 1")), "other");
});
