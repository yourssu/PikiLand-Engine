import { Octokit } from "@octokit/rest";
import * as fflate from "fflate";

export class GithubAdapter {

  private getOctokit(token: string): Octokit {
    return new Octokit({ auth: token });
  }

  public async fetchIssueBody(repoFullName: string, issueNumberStr: string, token: string): Promise<string> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repository full name format: ${repoFullName}`);
    }

    const octokit = this.getOctokit(token);
    const issueNumber = parseInt(issueNumberStr, 10);
    const response = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const title = response.data.title || "";
    const body = response.data.body || "";
    return `Issue #${issueNumber} Title: ${title}\n\n${body}`;
  }

  public async downloadWorkflowLogs(repoFullName: string, runIdStr: string, token: string): Promise<string> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repository full name format: ${repoFullName}`);
    }

    const octokit = this.getOctokit(token);
    const runId = parseInt(runIdStr, 10);

    const response = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });

    // Handle zip stream from GitHub response buffer
    const buffer = Buffer.from(response.data as ArrayBuffer);
    return await this.extractAndTruncateLogsFromZip(buffer);
  }

  private async extractAndTruncateLogsFromZip(zipBuffer: Buffer): Promise<string> {
    try {
      const unzipped = fflate.unzipSync(zipBuffer);
      const textDecoder = new TextDecoder("utf-8");
      let combinedLogs = "";
      let totalBytes = 0;
      const maxBytes = 50 * 1024 * 1024; // 50MB
      let entryCount = 0;
      const maxEntries = 500;

      for (const [filename, fileData] of Object.entries(unzipped)) {
        entryCount++;
        if (entryCount > maxEntries) {
          console.error(`[Zip Guard] Exceeded max allowed entries limit (${maxEntries}). Truncating log unzipping.`);
          break;
        }

        if (filename.endsWith(".txt") || !filename.includes("/")) {
          const content = textDecoder.decode(fileData);
          totalBytes += fileData.byteLength;
          combinedLogs += `=== File: ${filename} ===\n${content}\n\n`;
          if (totalBytes > maxBytes) {
            console.error(`[Zip Guard] Exceeded max allowed size limit (50MB). Truncating log unzipping.`);
            combinedLogs += "\n... [Log Truncated - Reached maximum allowed 50MB uncompressed limit] ...\n";
            break;
          }
        }
      }

      return combinedLogs;
    } catch (err) {
      console.error("[GitHubAdapter] Error unzipping workflow logs:", err);
      return "[Error extracting zip logs from GitHub Actions response]";
    }
  }


  public async createPullRequest(
    repoFullName: string,
    title: string,
    body: string,
    headBranch: string,
    baseBranch: string,
    token: string
  ): Promise<string | null> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repository full name format: ${repoFullName}`);
    }

    const octokit = this.getOctokit(token);
    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: headBranch,
      base: baseBranch,
    });

    return response.data.html_url || null;
  }
}
