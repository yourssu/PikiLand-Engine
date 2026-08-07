import { describe, expect, test } from "bun:test";
import { WorkspaceAdapter } from "../../adapters/workspace/workspace.adapter";
import {
  createOpencodeReadTool,
  createOpencodeEditTool,
  createOpencodeWriteTool,
  createOpencodeListTool,
  createOpencodeGrepTool,
  createOpencodeBashTool,
  createOpencodeManageTaskTool,
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
    const bashTool = createOpencodeBashTool(workspaceAdapter, workspacePath);
    const manageTaskTool = createOpencodeManageTaskTool(workspaceAdapter);

    expect(readTool.description).toContain("Reads");
    expect(editTool.description).toContain("Edits");
    expect(writeTool.description).toContain("Writes");
    expect(listTool.description).toContain("Lists");
    expect(grepTool.description).toContain("Searches");
    expect(bashTool.description).toContain("Executes a shell command");
    expect(manageTaskTool.description).toContain("Manages background shell tasks");
  });
});
