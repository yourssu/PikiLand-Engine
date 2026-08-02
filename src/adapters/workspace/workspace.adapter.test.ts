import { describe, expect, test } from "bun:test";
import { WorkspaceAdapter } from "./workspace.adapter";

describe("WorkspaceAdapter Test", () => {
  const adapter = new WorkspaceAdapter();

  test("should redact token secrets from text", () => {
    const raw = "https://x-access-token:ghp_1234567890abcdef@github.com/yourssu/PikiLand.git";
    const redacted = adapter.redactSecrets(raw);
    expect(redacted).toBe("https://x-access-token:***@github.com/yourssu/PikiLand.git");
  });

  test("should block subshell injection in harness commands", async () => {
    const res = await adapter.runHarness(".", "$(rm -rf /)");
    expect(res.success).toBeFalse();
    expect(res.output).toContain("disallowed subshell pattern");
  });

  test("should apply exact match patch", () => {
    const content = "function hello() {\n  console.log('world');\n}";
    const oldCode = "console.log('world');";
    const newCode = "console.log('hello world');";
    const result = adapter.applyRobustPatch(content, oldCode, newCode);
    expect(result).toBe("function hello() {\n  console.log('hello world');\n}");
  });

  test("should apply CRLF vs LF normalized patch", () => {
    const content = "line1\r\nline2\r\nline3";
    const oldCode = "line2\n";
    const newCode = "line2_fixed\n";
    const result = adapter.applyRobustPatch(content, oldCode, newCode);
    expect(result).toContain("line2_fixed");
  });

  test("should apply trimmed line matching patch", () => {
    const content = "  function test() {\n    const x = 1;\n  }";
    const oldCode = "const x = 1;";
    const newCode = "const x = 2;";
    const result = adapter.applyRobustPatch(content, oldCode, newCode);
    expect(result).toContain("const x = 2;");
  });

  test("should apply anchor matching patch when AI hallucinated middle comments or whitespace", () => {
    const content = "function processData() {\n  // Original comment\n  const value = getData();\n  return value;\n}";
    const oldCode = "function processData() {\n  // Hallucinated comment\n  return value;\n}";
    const newCode = "function processData() {\n  const value = getFixedData();\n  return value;\n}";
    const result = adapter.applyRobustPatch(content, oldCode, newCode);
    expect(result).toContain("getFixedData()");
  });

  test("should detect restricted paths and block path traversal attempts", () => {
    expect(adapter.isRestrictedPath("/app", "/app/.env")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/node_modules/pkg/index.js")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.git/config")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/../etc/passwd")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/etc/passwd")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/home/runner/.ssh/id_rsa")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/src/index.ts")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/tests/unit.test.js")).toBeFalse();
  });

  test("should count source files excluding restricted dirs", async () => {
    const count = await adapter.countSourceFiles(".");
    expect(count).toBeGreaterThan(0);
  });
});

