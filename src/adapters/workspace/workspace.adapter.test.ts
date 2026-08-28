import { describe, expect, test } from "bun:test";
import { WorkspaceAdapter } from "./workspace.adapter";

describe("WorkspaceAdapter Test", () => {
  const adapter = new WorkspaceAdapter();

  test("should redact token secrets from text", () => {
    const raw = "https://x-access-token:ghp_1234567890abcdef@github.com/yourssu/PikiLand.git";
    const redacted = adapter.redactSecrets(raw);
    expect(redacted).toBe("https://x-access-token:***@github.com/yourssu/PikiLand.git");

    expect(adapter.redactSecrets("Token: ghp_123456789012345678901234567890")).toContain("ghp_***");
    expect(adapter.redactSecrets("Key: sk-proj-12345678901234567890123456")).toContain("sk-***");
    expect(adapter.redactSecrets("Auth: Bearer secret-auth-token-1234567890")).toContain("Bearer ***");
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
    // Blocked secret files & envs
    expect(adapter.isRestrictedPath("/app", "/app/.env")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.env.local")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.env.production")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/secrets/private.key")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/certs/server.pem")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.aws/credentials")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.ssh/id_rsa")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/node_modules/pkg/index.js")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/.git/config")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/app/../etc/passwd")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/etc/passwd")).toBeTrue();
    expect(adapter.isRestrictedPath("/app", "/home/runner/.ssh/id_rsa")).toBeTrue();

    // Allowed template envs & source code files
    expect(adapter.isRestrictedPath("/app", "/app/.env.example")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/.env.sample")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/.env.template")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/src/PemUtils.java")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/src/KeyManager.ts")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/src/index.ts")).toBeFalse();
    expect(adapter.isRestrictedPath("/app", "/app/tests/unit.test.js")).toBeFalse();
  });

  test("should count source files excluding restricted dirs", async () => {
    const count = await adapter.countSourceFiles(".");
    expect(count).toBeGreaterThan(0);
  });

  test("should block dangerous bash commands with pinpoint rules", async () => {
    const resRm = await adapter.runBashCommand(".", "rm -rf /");
    expect(resRm.exitCode).toBe(1);
    expect(resRm.stderr).toContain("Security Guard");

    const resEnv = await adapter.runBashCommand(".", "cat .env");
    expect(resEnv.exitCode).toBe(1);
    expect(resEnv.stderr).toContain("Security Guard");
  });

  test("should execute normal bash commands quietly and return stdout to AI", async () => {
    const res = await adapter.runBashCommand(".", "echo 'hello pikiland'");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello pikiland");
  });

  test("should handle manageTask list, status, kill and pkill actions", async () => {
    const listRes = await adapter.manageTask("list", null, null);
    expect(listRes).toContain("No active background tasks");

    const statusErr = await adapter.manageTask("status", null, null);
    expect(statusErr).toContain("Error: taskId is required");

    const pkillRes = await adapter.manageTask("pkill", null, "non_existent_process_123456");
    expect(typeof pkillRes).toBe("string");

    // Test background task execution and manageTask
    const bgTaskRes = await adapter.runBashCommand(".", "sleep 2", 10, true);
    expect(bgTaskRes.exitCode).toBe(0);
    expect(bgTaskRes.taskId).toBeDefined();
    expect(bgTaskRes.stdout).toContain("[Background Task Started]");

    const activeListRes = await adapter.manageTask("list", null, null);
    expect(activeListRes).toContain(bgTaskRes.taskId!);

    const taskStatusRes = await adapter.manageTask("status", bgTaskRes.taskId!, null);
    expect(taskStatusRes).toContain(bgTaskRes.taskId!);

    const killRes = await adapter.manageTask("kill", bgTaskRes.taskId!, null);
    expect(killRes).toContain("Successfully killed background task");
  });
});

