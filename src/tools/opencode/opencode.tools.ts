/**
 * Ported from OpenCode (https://github.com/anomalyco/opencode)
 * Copyright (c) anomalyco/opencode
 * Licensed under the MIT License (https://opensource.org/licenses/MIT)
 */

import { tool } from "ai";
import { z } from "zod";
import { WorkspaceAdapter } from "../../adapters/workspace/workspace.adapter";

/**
 * OpenCode Read Tool: Reads workspace file contents with line numbers.
 * OpenAI Strict Schema compliant.
 */
export const createOpencodeReadTool = (workspaceAdapter: WorkspaceAdapter, workspacePath: string) =>
  tool({
    description: "Reads the content of a workspace file with 1-based line numbers. Returns line-numbered source code.",
    parameters: z.object({
      filePath: z.string().describe("Relative file path from project workspace root (e.g. 'src/index.ts')."),
    }),
    execute: async ({ filePath }) => {
      console.log(`   [Agent Tool Call] read: ${filePath}`);
      return await workspaceAdapter.readFile(workspacePath, filePath);
    },
  });

/**
 * OpenCode Edit Tool: Edits workspace file in-place by replacing oldContent with newContent.
 * Returns instant diagnostic error if target text is not found.
 * OpenAI Strict Schema compliant.
 */
export const createOpencodeEditTool = (workspaceAdapter: WorkspaceAdapter, workspacePath: string) =>
  tool({
    description: "Edits a workspace file in-place by replacing oldContent with newContent. Returns diagnostic error if target text is not found.",
    parameters: z.object({
      filePath: z.string().describe("Relative file path from project workspace root."),
      oldContent: z.string().describe("Exact existing content block to replace (copied from read tool)."),
      newContent: z.string().describe("New content block to insert."),
    }),
    execute: async ({ filePath, oldContent, newContent }) => {
      console.log(`   [Agent Tool Call] edit: ${filePath}`);
      return await workspaceAdapter.editFile(workspacePath, filePath, oldContent, newContent);
    },
  });

/**
 * OpenCode Write Tool: Writes full content to a file (creates file if missing).
 * OpenAI Strict Schema compliant.
 */
export const createOpencodeWriteTool = (workspaceAdapter: WorkspaceAdapter, workspacePath: string) =>
  tool({
    description: "Writes full content to a workspace file (creates new file if missing).",
    parameters: z.object({
      filePath: z.string().describe("Relative file path from project workspace root."),
      content: z.string().describe("Full source code content to write."),
    }),
    execute: async ({ filePath, content }) => {
      console.log(`   [Agent Tool Call] write: ${filePath}`);
      return await workspaceAdapter.writeFile(workspacePath, filePath, content);
    },
  });

/**
 * OpenCode List Tool: Lists subdirectories and files in a directory path.
 * OpenAI Strict Schema compliant.
 */
export const createOpencodeListTool = (workspaceAdapter: WorkspaceAdapter, workspacePath: string) =>
  tool({
    description: "Lists subdirectories and files in a workspace folder path.",
    parameters: z.object({
      dirPath: z.string().describe("Relative directory path from workspace root (e.g. '.', 'src')."),
    }),
    execute: async ({ dirPath }) => {
      const targetDir = dirPath || ".";
      console.log(`   [Agent Tool Call] list: ${targetDir}`);
      return await workspaceAdapter.listDirectory(workspacePath, targetDir);
    },
  });

/**
 * OpenCode Grep Tool: Searches for text pattern or symbol inside a file.
 * OpenAI Strict Schema compliant.
 */
export const createOpencodeGrepTool = (workspaceAdapter: WorkspaceAdapter, workspacePath: string) =>
  tool({
    description: "Searches for a specific text pattern or symbol inside a file.",
    parameters: z.object({
      filePath: z.string().describe("Relative file path from project workspace root."),
      query: z.string().describe("Exact term or symbol to search for."),
    }),
    execute: async ({ filePath, query }) => {
      console.log(`   [Agent Tool Call] grep: ${filePath} (query: '${query}')`);
      return await workspaceAdapter.grepInFile(workspacePath, filePath, query);
    },
  });
