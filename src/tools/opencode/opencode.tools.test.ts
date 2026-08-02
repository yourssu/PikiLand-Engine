import { describe, expect, test } from "bun:test";
import { WorkspaceAdapter } from "../../adapters/workspace/workspace.adapter";
import {
  createOpencodeReadTool,
  createOpencodeEditTool,
  createOpencodeWriteTool,
  createOpencodeListTool,
  createOpencodeGrepTool,
} from "./opencode.tools";

describe("OpenCode Tools Unit Test", () => {
  const workspaceAdapter = new WorkspaceAdapter();
  const workspacePath = ".";

  test("should instantiate OpenCode tools properly", () => {
    const readTool = createOpencodeReadTool(workspaceAdapter, workspacePath);
    const editTool = createOpencodeEditTool(workspaceAdapter, workspacePath);
    const writeTool = createOpencodeWriteTool(workspaceAdapter, workspacePath);
    const listTool = createOpencodeListTool(workspaceAdapter, workspacePath);
    const grepTool = createOpencodeGrepTool(workspaceAdapter, workspacePath);

    expect(readTool.description).toContain("Reads");
    expect(editTool.description).toContain("Edits");
    expect(writeTool.description).toContain("Writes");
    expect(listTool.description).toContain("Lists");
    expect(grepTool.description).toContain("Searches");
  });
});
