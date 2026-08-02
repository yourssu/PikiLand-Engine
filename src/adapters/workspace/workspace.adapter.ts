import { execa } from "execa";
import { simpleGit, SimpleGit } from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import { HarnessResult, PatchInstruction } from "../../domain/models";

const RESTRICTED_DIRS = [".git", ".venv", "node_modules", "build", "dist", "target", "out"];
const RESTRICTED_FILES = [".env", "secrets.json", "credentials"];
const DANGEROUS_SUB_SHELL_PATTERNS = ["$(", "`", "eval ", "exec "];

export class WorkspaceAdapter {
  public redactSecrets(text: string | null | undefined): string {
    if (!text) return "";
    return text.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
  }

  public isRestrictedPath(workspacePath: string, targetPath: string): boolean {
    const normWorkspace = path.resolve(workspacePath);
    const normTarget = path.resolve(targetPath);
    if (!normTarget.startsWith(normWorkspace)) {
      return true;
    }
    const relative = path.relative(normWorkspace, normTarget);
    const parts = relative.split(path.sep);
    for (const part of parts) {
      if (RESTRICTED_DIRS.includes(part) || RESTRICTED_FILES.includes(part)) {
        return true;
      }
    }
    return false;
  }

  public async runHarness(workspacePath: string, harnessCmd: string, timeoutMs: number = 180000): Promise<HarnessResult> {
    if (!harnessCmd || harnessCmd.trim().length === 0) {
      return { success: false, output: "Empty harness command.", exitCode: 1 };
    }

    for (const pattern of DANGEROUS_SUB_SHELL_PATTERNS) {
      if (harnessCmd.includes(pattern)) {
        const errMsg = `Security Error: Harness command contains disallowed subshell pattern '${pattern}'. Execution aborted.`;
        console.error(`[Harness Security] ${errMsg}`);
        return { success: false, output: errMsg, exitCode: 1 };
      }
    }

    try {
      const result = await execa({
        cwd: workspacePath,
        shell: true,
        reject: false,
        timeout: timeoutMs,
      })`${harnessCmd}`;

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const output = this.redactSecrets(`${stdout}\n${stderr}`.trim());

      return {
        success: result.exitCode === 0,
        output,
        exitCode: result.exitCode ?? 1,
      };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
      const rawOutput = `${execError.stdout || ""}\n${execError.stderr || ""}\n${execError.message || ""}`.trim();
      const output = this.redactSecrets(rawOutput);
      return {
        success: false,
        output,
        exitCode: execError.exitCode ?? 1,
      };
    }
  }

  public async resetToCleanState(workspacePath: string, initialRef: string): Promise<void> {
    const git: SimpleGit = simpleGit(workspacePath);
    await git.reset(["--hard"]);
    await git.clean("f", ["-d"]);
    if (initialRef && initialRef !== "HEAD") {
      await git.checkout(initialRef);
    }
  }

  public async applyPatches(workspacePath: string, patches: PatchInstruction[]): Promise<boolean> {
    try {
      let appliedCount = 0;
      for (const patch of patches) {
        const fullPath = path.isAbsolute(patch.filePath)
          ? path.resolve(patch.filePath)
          : path.resolve(workspacePath, patch.filePath);

        if (this.isRestrictedPath(workspacePath, fullPath)) {
          console.error(`[Workspace] Access Denied: Restricted patch target: ${patch.filePath}`);
          continue;
        }

        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });

        let fileContent = "";
        let exists = true;
        try {
          fileContent = await fs.readFile(fullPath, "utf-8");
        } catch {
          exists = false;
          fileContent = "";
        }

        if (!exists) {
          await fs.writeFile(fullPath, patch.newCode, "utf-8");
          appliedCount++;
          continue;
        }

        const patchedContent = this.applyRobustPatch(fileContent, patch.oldCode, patch.newCode);
        if (patchedContent !== null) {
          console.log(`[Workspace] Applying patch to: ${patch.filePath}`);
          await fs.writeFile(fullPath, patchedContent, "utf-8");
          appliedCount++;
        } else {
          console.error(`[Workspace] Warning: Target oldCode not found in: ${patch.filePath}`);
        }
      }
      return appliedCount > 0 && appliedCount === patches.length;
    } catch (error) {
      console.error("[Workspace] Failed to apply patches:", error);
      return false;
    }
  }

  public applyRobustPatch(content: string, oldCode: string, newCode: string): string | null {
    if (content === null || oldCode === null || newCode === null) return null;
    if (oldCode.length === 0) return newCode;

    // Step 1: Direct Exact Match
    const matchIndex = content.indexOf(oldCode);
    if (matchIndex >= 0) {
      return content.substring(0, matchIndex) + newCode + content.substring(matchIndex + oldCode.length);
    }

    // Step 2: EOL Normalized Match (\r\n -> \n)
    const hasCrlf = content.includes("\r\n");
    const normContent = content.replace(/\r\n/g, "\n");
    const normOld = oldCode.replace(/\r\n/g, "\n");
    const normNew = newCode.replace(/\r\n/g, "\n");

    const normIndex = normContent.indexOf(normOld);
    if (normIndex >= 0) {
      const patchedNorm = normContent.substring(0, normIndex) + normNew + normContent.substring(normIndex + normOld.length);
      return hasCrlf ? patchedNorm.replace(/\n/g, "\r\n") : patchedNorm;
    }

    // Step 3: Line-by-Line Trimmed Matching
    return this.replaceByTrimmedLines(content, oldCode, newCode);
  }

  private replaceByTrimmedLines(content: string, oldCode: string, newCode: string): string | null {
    const hasCrlf = content.includes("\r\n");
    const contentLines = content.split(/\r?\n/);
    const oldLines = oldCode.split(/\r?\n/);

    const targetTrimmed = oldLines.map(l => l.trim());
    while (targetTrimmed.length > 0 && targetTrimmed[targetTrimmed.length - 1] === "") {
      targetTrimmed.pop();
    }
    if (targetTrimmed.length === 0) return null;

    let matchStartLine = -1;
    let matchEndLine = -1;

    for (let i = 0; i <= contentLines.length - targetTrimmed.length; i++) {
      let matched = true;
      for (let j = 0; j < targetTrimmed.length; j++) {
        if (contentLines[i + j]!.trim() !== targetTrimmed[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        matchStartLine = i;
        matchEndLine = i + targetTrimmed.length - 1;
        break;
      }
    }

    if (matchStartLine === -1) {
      return null;
    }

    const newContentLines: string[] = [];
    for (let i = 0; i < matchStartLine; i++) {
      newContentLines.push(contentLines[i]!);
    }
    const replacementLines = newCode.split(/\r?\n/);
    for (const line of replacementLines) {
      newContentLines.push(line);
    }
    for (let i = matchEndLine + 1; i < contentLines.length; i++) {
      newContentLines.push(contentLines[i]!);
    }

    const delimiter = hasCrlf ? "\r\n" : "\n";
    return newContentLines.join(delimiter);
  }

  public async commitAndPush(
    workspacePath: string,
    branchName: string,
    commitMsg: string,
    token: string,
    repoFullName: string
  ): Promise<void> {
    const git: SimpleGit = simpleGit(workspacePath);
    await git.checkoutLocalBranch(branchName);
    await git.add(".");
    await git.commit(commitMsg);

    // Authenticated remote URL
    const remoteUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
    await git.push(remoteUrl, branchName, ["--set-upstream"]);
  }

  public async listDirectory(workspacePath: string, relativePath: string = "."): Promise<string> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      const targetDir = path.resolve(normWorkspace, relativePath || ".");

      if (!targetDir.startsWith(normWorkspace)) {
        return "Access Denied: Path is outside the project workspace.";
      }

      if (this.isRestrictedPath(workspacePath, targetDir)) {
        return "Access Denied: Restricted directory.";
      }

      let entries;
      try {
        entries = await fs.readdir(targetDir, { withFileTypes: true });
      } catch {
        return `Directory not found: ${relativePath}`;
      }

      const subdirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        const name = entry.name;
        if (RESTRICTED_DIRS.includes(name) || RESTRICTED_FILES.includes(name)) {
          continue;
        }
        if (entry.isDirectory()) {
          subdirs.push(name);
        } else {
          files.push(name);
        }
      }

      subdirs.sort();
      files.sort();

      const displayPath = relativePath.trim().length === 0 ? "." : relativePath;
      return `[Directory: ${displayPath}]\n- Subdirectories: ${
        subdirs.length === 0 ? "(None)" : subdirs.join(", ")
      }\n- Files: ${files.length === 0 ? "(None)" : files.join(", ")}`;
    } catch (e: unknown) {
      return `Error reading directory: ${(e as Error).message || e}`;
    }
  }

  public async readFile(workspacePath: string, relativePath: string): Promise<string> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      const targetFile = path.resolve(normWorkspace, relativePath);

      if (!targetFile.startsWith(normWorkspace)) {
        return "Access Denied: Path is outside the project workspace.";
      }

      if (this.isRestrictedPath(workspacePath, targetFile)) {
        return "Access Denied: Restricted file path.";
      }

      let content: string;
      try {
        content = await fs.readFile(targetFile, "utf-8");
      } catch {
        return `File not found: ${relativePath}`;
      }

      const lines = content.split(/\r?\n/);
      const maxLines = 1000;
      if (lines.length > maxLines) {
        const truncated = lines.slice(0, maxLines).join("\n");
        return `${truncated}\n... [Content Truncated - File has ${lines.length} lines total, showing first ${maxLines}] ...`;
      }
      return content;
    } catch (e: unknown) {
      return `Error reading file: ${(e as Error).message || e}`;
    }
  }

  public async countSourceFiles(workspacePath: string): Promise<number> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      let fileCount = 0;

      const walk = async (dirPath: string) => {
        let entries;
        try {
          entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (RESTRICTED_DIRS.includes(entry.name) || RESTRICTED_FILES.includes(entry.name) || this.isRestrictedPath(normWorkspace, fullPath)) {
            continue;
          }
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
          }
        }
      };

      await walk(normWorkspace);
      return fileCount > 0 ? fileCount : 50;
    } catch {
      return 50;
    }
  }

  public async grepInFile(workspacePath: string, relativePath: string, query: string): Promise<string> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      const targetFile = path.resolve(normWorkspace, relativePath);

      if (!targetFile.startsWith(normWorkspace)) {
        return "Access Denied: Path is outside the project workspace.";
      }

      if (this.isRestrictedPath(workspacePath, targetFile)) {
        return "Access Denied: Restricted file path.";
      }

      let content: string;
      try {
        content = await fs.readFile(targetFile, "utf-8");
      } catch {
        return `File not found: ${relativePath}`;
      }

      const lines = content.split(/\r?\n/);
      const matches: string[] = [];
      const queryLower = query.toLowerCase();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.toLowerCase().includes(queryLower)) {
          matches.push(`[Line ${i + 1}]: ${line.trim()}`);
          if (matches.length >= 50) {
            matches.push("... [Matches capped at 50 results] ...");
            break;
          }
        }
      }

      if (matches.length === 0) {
        return `No matches found for '${query}' inside ${relativePath}.`;
      }
      return `[Matches in ${relativePath} for '${query}']:\n${matches.join("\n")}`;
    } catch (e: unknown) {
      return `Error searching file: ${(e as Error).message || e}`;
    }
  }

  public async getCurrentBranch(workspacePath: string): Promise<string> {
    const git: SimpleGit = simpleGit(workspacePath);
    const summary = await git.status();
    return summary.current || "main";
  }
}


