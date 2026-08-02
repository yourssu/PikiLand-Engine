import * as fs from "fs/promises";
import * as path from "path";
import { CliConfig, PrCandidate } from "../domain/models";
import { LogTruncator } from "../domain/log-truncator";
import { GithubAdapter } from "../adapters/github/github.adapter";
import { WorkspaceAdapter } from "../adapters/workspace/workspace.adapter";
import { AiAdapter } from "../adapters/ai/ai.adapter";
import { SlackAdapter } from "../adapters/slack/slack.adapter";
import { HarnessInferenceService } from "./harness-inference.service";

export class SelfHealingService {
  private logTruncator: LogTruncator;
  private githubAdapter: GithubAdapter;
  private workspaceAdapter: WorkspaceAdapter;
  private aiAdapter: AiAdapter;
  private slackAdapter: SlackAdapter;
  private harnessInferenceService: HarnessInferenceService;

  constructor() {
    this.logTruncator = new LogTruncator();
    this.githubAdapter = new GithubAdapter();
    this.workspaceAdapter = new WorkspaceAdapter();
    this.aiAdapter = new AiAdapter();
    this.slackAdapter = new SlackAdapter();
    this.harnessInferenceService = new HarnessInferenceService();
  }

  public async run(config: CliConfig): Promise<void> {
    console.log(`Starting TS-Bun CLI Self-Healing for ${config.repoName} on workspace: ${config.workspacePath}`);

    let logContent = config.logContent;

    // Download log or issue body dynamically if logContent is empty
    if (!logContent || logContent.trim().length === 0) {
      if (!config.runId) {
        throw new Error("Either PIKILAND_LOG_CONTENT or a valid PIKILAND_RUN_ID is required.");
      }
      if (config.eventType === "workflow_run") {
        console.log(`[CLI] Log content omitted. Downloading workflow logs for Run ID: ${config.runId} in ${config.repoName}`);
        const rawLogs = await this.githubAdapter.downloadWorkflowLogs(config.repoName, config.runId, config.token);
        logContent = this.logTruncator.truncateLogForAi(rawLogs, 300);
      } else if (config.eventType === "issues") {
        console.log(`[CLI] Log content omitted. Fetching issue body for Issue #${config.runId} in ${config.repoName}`);
        logContent = await this.githubAdapter.fetchIssueBody(config.repoName, config.runId, config.token);
      }
    }

    if (!logContent || logContent.trim().length === 0) {
      throw new Error(`Failed to acquire log content or issue body for event: ${config.eventType}, run_id: ${config.runId}`);
    }

    // 1. Safety Check: Verify presence of AGENTS.md or AI.md
    const allowedAgentFiles = ["AGENTS.md", "agents.md", ".agents.md", "AI.md", "ai.md"];
    let agentsFileExists = false;
    for (const filename of allowedAgentFiles) {
      try {
        await fs.access(path.join(config.workspacePath, filename));
        agentsFileExists = true;
        break;
      } catch {
        // file not found, check next
      }
    }

    if (!agentsFileExists) {
      console.error("PikiLand execution DENIED: No 'AGENTS.md' or 'AI.md' file found in the root of the repository.");
      throw new Error("Execution denied: Missing AGENTS.md or AI.md safety file.");
    }
    console.log("Safety check passed: AGENTS.md or AI.md file found.");

    // 2. Pre-patch Harness Check (Bug Reproduction Gate)
    let harnessCmd = config.harnessCmd;
    if (!harnessCmd || harnessCmd.trim().length === 0) {
      const inferred = await this.harnessInferenceService.inferHarnessCmdFromWorkspace(config.workspacePath);
      if (inferred) {
        harnessCmd = inferred;
        console.log(`[Harness] Smart runtime-inferred harness command: ${harnessCmd}`);
      }
    }

    if (harnessCmd && harnessCmd.trim().length > 0) {
      console.log(`[Harness] Executing pre-patch harness command to reproduce issue: ${harnessCmd}`);
      const hResBefore = await this.workspaceAdapter.runHarness(config.workspacePath, harnessCmd);
      if (hResBefore.success) {
        console.error("[Harness] Bug reproduction FAILED: Tests passed on buggy workspace (Red verification failed).");
        console.error("[Harness] Discarding patching process as issue is not reproducible.");
        return;
      }
      console.log("[Harness] Bug reproduction SUCCEEDED: Tests failed as expected on buggy workspace. Proceeding to patch generation.");
    }

    // 3. AI Analysis & Diagnostics (AI directly edits files in workspace via OpenCode tools)
    const aiResult = await this.aiAdapter.analyzeError(config, logContent, config.workspacePath);

    const prUrls: string[] = [];

    if (aiResult.prNeeded && aiResult.prCandidates && aiResult.prCandidates.length > 0) {
      console.log(`AI requested PR. Evaluating candidate(s) for the Single Best PR...`);

      let baseBranch = config.targetBranch;
      if (!baseBranch || baseBranch.trim().length === 0) {
        baseBranch = await this.workspaceAdapter.getCurrentBranch(config.workspacePath);
      }
      if (baseBranch === "HEAD") {
        baseBranch = "main";
      }

      let selectedCandidate: PrCandidate = aiResult.prCandidates[0]!;
      let isVerified = false;

      // 4. Direct Harness Verification on AI-edited workspace
      if (!harnessCmd || harnessCmd.trim().length === 0) {
        console.log(`[Harness] No harness command specified. Accepting AI in-place workspace edits.`);
        isVerified = true;
      } else {
        console.log(`[Harness] Executing post-patch harness command directly on workspace: ${harnessCmd}`);
        const hRes = await this.workspaceAdapter.runHarness(config.workspacePath, harnessCmd);

        if (hRes.success) {
          console.log(`[Harness] Direct workspace verification SUCCEEDED! All tests passed.`);
          isVerified = true;
        } else {
          console.error(`[Harness] Initial workspace verification FAILED. Initiating Ralph Loop refinement...`);
          
          const triedHarnessOutputCounts = new Map<string, number>();
          let lastHarnessOutput = hRes.output;

          for (let retry = 1; retry <= config.maxRetries; retry++) {
            console.log(`[Ralph Loop] Refinement Attempt ${retry}/${config.maxRetries}`);
            try {
              const trimmedOutput = this.logTruncator.truncateLogForAi(lastHarnessOutput, 150);
              const count = (triedHarnessOutputCounts.get(trimmedOutput) || 0) + 1;
              triedHarnessOutputCounts.set(trimmedOutput, count);
              if (count > 2) {
                console.error("[Ralph Loop] Infinite Loop Guard: Duplicate harness output detected. Aborting refinement.");
                break;
              }

              const refinedResult = await this.aiAdapter.refinePatch(
                config,
                logContent,
                config.workspacePath,
                trimmedOutput
              );
              if (!refinedResult || !refinedResult.prNeeded || !refinedResult.prCandidates || refinedResult.prCandidates.length === 0) break;

              console.log(`[Harness] Executing post-refinement harness verification: ${harnessCmd}`);
              const hResRetry = await this.workspaceAdapter.runHarness(config.workspacePath, harnessCmd);
              if (hResRetry.success) {
                console.log(`[Harness] Refinement SUCCEEDED on attempt ${retry}! All tests passed.`);
                isVerified = true;
                break;
              }
              lastHarnessOutput = hResRetry.output;
            } catch (ex) {
              console.error("Error in refinement loop:", ex);
              break;
            }
          }
        }
      }

      // Publish PR directly from verified workspace
      if (isVerified) {
        try {
          const branchName = `fix/ai-verified-patch-${Date.now()}`;
          const commitMsg = selectedCandidate.prTitle || "fix: automated AI bug patch";

          await this.workspaceAdapter.commitAndPush(config.workspacePath, branchName, commitMsg, config.token, config.repoName);

          let detailedPrBody = selectedCandidate.prBody || "";
          if (logContent && logContent.trim().length > 0) {
            detailedPrBody += `\n\n---\n\n<details>\n<summary>🔍 원본 에러 로그 및 발생 Context 보기</summary>\n\n\`\`\`\n${logContent}\n\`\`\`\n</details>`;
          }

          const prUrl = await this.githubAdapter.createPullRequest(
            config.repoName,
            selectedCandidate.prTitle || "fix: automated AI bug patch",
            detailedPrBody,
            branchName,
            baseBranch,
            config.token
          );

          if (prUrl) {
            prUrls.push(prUrl);
            console.log(`Successfully created Single Best Verified PR: ${prUrl}`);
          }
        } catch (ex) {
          console.error("Failed to create PR for verified candidate:", ex);
        }
      } else {
        console.log("No PR candidates passed harness verification. No PR was created.");
      }
    }

    // 4. Slack Notification
    if (config.slackWebhookUrl && config.slackWebhookUrl.trim().length > 0) {
      await this.slackAdapter.sendNotification(
        config.slackWebhookUrl,
        logContent,
        aiResult,
        config.eventType,
        config.repoName,
        config.runId || "cli",
        prUrls
      );
    } else {
      console.log("Slack webhook is not set. Diagnostics result:");
      console.log("Summary:", aiResult.summary);
      console.log("PR Candidates created:", prUrls);
    }
  }
}
