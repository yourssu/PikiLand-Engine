import { execa } from "execa";
import { simpleGit, SimpleGit } from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import { HarnessResult } from "../../domain/models";

const RESTRICTED_DIRS = [".git", ".venv", "node_modules", "build", "dist", "target", "out", ".aws", ".ssh", ".idea", ".vscode"];
const RESTRICTED_FILES = [".env", "secrets.json", "credentials", "id_rsa", "id_ed25519", "service-account.json", "keystore.jks"];
const RESTRICTED_EXTENSIONS = [".pem", ".key", ".pfx", ".p12", ".pkcs12"];
const ALLOWED_ENV_FILES = [".env.example", ".env.sample", ".env.template"];
const DANGEROUS_SUB_SHELL_PATTERNS = ["$(", "`", "eval ", "exec "];

export class WorkspaceAdapter {
  public redactSecrets(text: string | null | undefined): string {
    if (!text) return "";
    return text.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
  }

  public isRestrictedPath(workspacePath: string, targetPath: string): boolean {
    const normWorkspace = path.resolve(workspacePath);
    const normTarget = path.resolve(targetPath);
    
    // 1. Path Traversal Guard: Block any access outside workspace root
    const relative = path.relative(normWorkspace, normTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !normTarget.startsWith(normWorkspace)) {
      return true;
    }

    // 2. Restricted System & Secret Directories/Files Guard
    const parts = relative.split(path.sep);
    for (const part of parts) {
      if (ALLOWED_ENV_FILES.includes(part)) {
        continue;
      }

      if (RESTRICTED_DIRS.includes(part) || RESTRICTED_FILES.includes(part)) {
        return true;
      }

      if (part.startsWith(".env.")) {
        return true;
      }

      const ext = path.extname(part);
      if (ext && RESTRICTED_EXTENSIONS.includes(ext)) {
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
    const trimmedMatch = this.replaceByTrimmedLines(content, oldCode, newCode);
    if (trimmedMatch !== null) {
      return trimmedMatch;
    }

    // Step 4: Sub-block Anchor Line Matching (Fallback for AI hallucinated whitespace/comments)
    return this.replaceByAnchorMatching(content, oldCode, newCode);
  }

  private replaceByAnchorMatching(content: string, oldCode: string, newCode: string): string | null {
    const hasCrlf = content.includes("\r\n");
    const contentLines = content.split(/\r?\n/);
    const oldLines = oldCode.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (oldLines.length === 0) return null;

    const firstAnchor = oldLines[0]!;
    const lastAnchor = oldLines[oldLines.length - 1]!;

    for (let startIdx = 0; startIdx < contentLines.length; startIdx++) {
      if (contentLines[startIdx]!.trim() === firstAnchor) {
        const searchUpperLimit = Math.min(contentLines.length, startIdx + oldLines.length + 15);
        for (let endIdx = startIdx; endIdx < searchUpperLimit; endIdx++) {
          if (contentLines[endIdx]!.trim() === lastAnchor) {
            const newContentLines: string[] = [];
            for (let i = 0; i < startIdx; i++) {
              newContentLines.push(contentLines[i]!);
            }
            const replacementLines = newCode.split(/\r?\n/);
            for (const line of replacementLines) {
              newContentLines.push(line);
            }
            for (let i = endIdx + 1; i < contentLines.length; i++) {
              newContentLines.push(contentLines[i]!);
            }
            const delimiter = hasCrlf ? "\r\n" : "\n";
            return newContentLines.join(delimiter);
          }
        }
      }
    }
    return null;
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
    repoFullName: string,
    gitUserName?: string,
    gitUserEmail?: string
  ): Promise<void> {
    const git: SimpleGit = simpleGit(workspacePath);

    const userName = gitUserName || "pikiland-bot[bot]";
    const userEmail = gitUserEmail || "pikiland-bot[bot]@users.noreply.github.com";

    // Ensure Git author identity is configured for transient Runner environments
    await git.addConfig("user.name", userName, false, "local");
    await git.addConfig("user.email", userEmail, false, "local");

    await git.checkoutLocalBranch(branchName);
    await git.add(".");
    await git.commit(commitMsg);

    // Authenticated remote URL
    const remoteUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
    await git.push(remoteUrl, branchName, ["--set-upstream", "--force"]);
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

  public async writeFile(workspacePath: string, relativePath: string, content: string): Promise<string> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      const targetFile = path.resolve(normWorkspace, relativePath);
      if (this.isRestrictedPath(workspacePath, targetFile)) {
        return "Access Denied: Restricted file path.";
      }
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, content, "utf-8");
      return `Successfully written file: ${relativePath}`;
    } catch (e: unknown) {
      return `Error writing file: ${(e as Error).message || e}`;
    }
  }

  public async editFile(workspacePath: string, relativePath: string, oldContent: string, newContent: string): Promise<string> {
    try {
      const normWorkspace = path.resolve(workspacePath);
      const targetFile = path.resolve(normWorkspace, relativePath);
      if (this.isRestrictedPath(workspacePath, targetFile)) {
        return "Access Denied: Restricted file path.";
      }

      let content = "";
      let exists = true;
      try {
        content = await fs.readFile(targetFile, "utf-8");
      } catch {
        exists = false;
      }

      if (!exists) {
        await fs.mkdir(path.dirname(targetFile), { recursive: true });
        await fs.writeFile(targetFile, newContent, "utf-8");
        return `Successfully created new file: ${relativePath}`;
      }

      const patched = this.applyRobustPatch(content, oldContent, newContent);
      if (patched !== null) {
        await fs.writeFile(targetFile, patched, "utf-8");
        return `Successfully edited ${relativePath}`;
      }

      return `Error: Could not locate 'oldContent' in ${relativePath}. Please use 'read' tool to inspect the exact line content before retrying.`;
    } catch (e: unknown) {
      return `Error editing file: ${(e as Error).message || e}`;
    }
  }



  public async getCurrentBranch(workspacePath: string): Promise<string> {
    const git: SimpleGit = simpleGit(workspacePath);
    const summary = await git.status();
    return summary.current || "main";
  }

  /**
   * Executes bash command quietly inside workspacePath.
   * Stdout/stderr are returned to AI and not logged to runner console.
   */
  public async runBashCommand(
    workspacePath: string,
    command: string,
    timeoutSeconds: number = 60
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    if (this.isDangerousCommand(command)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `[Security Guard] Execution blocked: Command '${command}' matches pinpoint forbidden danger rules.`,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    try {
      const { execa } = await import("execa");
      const result = await execa("sh", ["-c", command], {
        cwd: workspacePath,
        timeout: timeoutSeconds * 1000,
        reject: false,
      });

      return {
        exitCode: result.exitCode ?? 0,
        stdout: this.redactSecrets(result.stdout || ""),
        stderr: this.redactSecrets(result.stderr || ""),
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: this.redactSecrets(err.message || String(err)),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private isDangerousCommand(command: string): boolean {
    const dangerousPatterns = [
      /rm\s+(-[rRfF]+\s+)*(\/|~|\.|\*)/i,       // rm -rf /, rm -rf ~, rm -rf *, rm -rf .
      /cat\s+(\.env|~\/\.ssh\/|\/etc\/shadow)/i, // cat .env, cat ~/.ssh/*, cat /etc/shadow
      /\b(shutdown|reboot|init 0|mkfs)\b/i,      // 파괴적 시스템 명령어
    ];
    return dangerousPatterns.some((pattern) => pattern.test(command));
  }

  private activeTasks = new Map<string, { id: string; command: string; startTime: Date; process?: any; outputBuffer: string[]; isFinished: boolean; exitCode: number | null }>();

  public async manageTask(
    action: "list" | "status" | "kill" | "pkill",
    taskId?: string | null,
    pattern?: string | null
  ): Promise<string> {
    if (action === "list") {
      if (this.activeTasks.size === 0) return "No active background tasks running.";
      const list = Array.from(this.activeTasks.values()).map(
        (t) => `• [${t.id}] Command: '${t.command}' | Status: ${t.isFinished ? `Finished (exitCode: ${t.exitCode})` : "Running"} | Started: ${t.startTime.toISOString()}`
      );
      return `Active Background Tasks (${this.activeTasks.size}):\n` + list.join("\n");
    }

    if (action === "status") {
      if (!taskId) return "Error: taskId is required for 'status' action.";
      const task = this.activeTasks.get(taskId);
      if (!task) return `Error: Task ID '${taskId}' not found.`;
      const recentLogs = task.outputBuffer.slice(-30).join("\n");
      return `Task ID: ${task.id}\nCommand: ${task.command}\nStatus: ${task.isFinished ? `Finished (Exit code: ${task.exitCode})` : "Running"}\nLogs:\n${recentLogs || "(No output captured yet)"}`;
    }

    if (action === "kill") {
      if (!taskId) return "Error: taskId is required for 'kill' action.";
      const task = this.activeTasks.get(taskId);
      if (!task) return `Error: Task ID '${taskId}' not found.`;
      try {
        if (task.process && typeof task.process.kill === "function") {
          task.process.kill("SIGTERM");
        }
        task.isFinished = true;
        this.activeTasks.delete(taskId);
        return `Successfully killed background task '${taskId}'.`;
      } catch (err: any) {
        return `Failed to kill task '${taskId}': ${err.message || err}`;
      }
    }

    if (action === "pkill") {
      if (!pattern) return "Error: pattern is required for 'pkill' action.";
      try {
        const { execa } = await import("execa");
        const res = await execa("pkill", ["-f", pattern], { reject: false });
        return res.exitCode === 0
          ? `Successfully killed processes matching pattern '${pattern}'.`
          : `No running process matched pattern '${pattern}'.`;
      } catch (err: any) {
        return `pkill execution failed: ${err.message || err}`;
      }
    }

    return "Invalid action specified.";
  }
}


