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

    // Download log or issue body dynamically if logContent is empty or if eventType is production_log
    if (config.eventType === "production_log" || !logContent || logContent.trim().length === 0) {
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
      } else if (config.eventType === "production_log") {
        let rawServerUrl = config.pikilandServerUrl || process.env.PIKILAND_SERVER_URL;
        let serverUrl = (rawServerUrl && rawServerUrl.trim().length > 0) ? rawServerUrl.trim() : "https://pikiland.yourssu.com";
        if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
          serverUrl = `https://${serverUrl}`;
        }
        if (serverUrl.startsWith("http://") && !serverUrl.includes("localhost") && !serverUrl.includes("127.0.0.1")) {
          serverUrl = serverUrl.replace("http://", "https://");
        }
        console.log(`[CLI] Fetching 100% full raw log via HTTPS (Port 443) from PikiLand Web App (${serverUrl}) for Hash: ${config.runId}`);
        try {
          const resp = await fetch(`${serverUrl}/api/settings/incidents/detail?hash=${config.runId}`, {
            headers: {
              "Authorization": `Bearer ${config.token}`
            }
          });
          if (resp.ok) {
            const data = (await resp.json()) as { rawLog?: string; normalizedSignature?: string };
            logContent = data.rawLog || data.normalizedSignature || `Production Error Incident Hash: ${config.runId}`;
            console.log(`[CLI] Successfully retrieved 100% full raw log (${logContent.length} chars) from PikiLand Web App.`);
          } else {
            const errMsg = `Reverse lookup API returned HTTP ${resp.status} for Hash: ${config.runId}`;
            console.error(`[CLI] ${errMsg}`);
            throw new Error(errMsg);
          }
        } catch (e: unknown) {
          const err = e as Error;
          console.error("[CLI] Reverse lookup API fetch failed:", err.message || err);
          throw new Error(`Reverse lookup failed for incident hash ${config.runId}: ${err.message || err}`);
        }
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

    if (config.eventType !== "production_log" && harnessCmd && harnessCmd.trim().length > 0) {
      console.log(`[Harness] Executing pre-patch harness command to reproduce issue: ${harnessCmd}`);
      const hResBefore = await this.workspaceAdapter.runHarness(config.workspacePath, harnessCmd);
      if (hResBefore.success) {
        console.error("[Harness] Bug reproduction FAILED: Tests passed on buggy workspace (Red verification failed).");
        console.error("[Harness] Discarding patching process as issue is not reproducible.");
        throw new Error("Self-healing failed: Issue is not reproducible on current workspace.");
      }
      console.log("[Harness] Bug reproduction SUCCEEDED: Tests failed as expected on buggy workspace. Proceeding to patch generation.");
    } else if (config.eventType === "production_log") {
      console.log("[Harness] Pre-patch bug reproduction check SKIPPED for production_log event as runtime behavior issues cannot be reproduced by unit test suite alone.");
    }

    // 3. AI Analysis & Diagnostics (AI directly edits files in workspace via OpenCode tools)
    const aiResult = await this.aiAdapter.analyzeError(config, logContent, config.workspacePath);

    // If prNeeded is true, ignore issue-related fields and prNotNeededReason completely
    if (aiResult.prNeeded) {
      aiResult.issueNeeded = false;
      aiResult.issueTitle = undefined;
      aiResult.issueBody = undefined;
      aiResult.prNotNeededReason = undefined;
    }

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
          const hashTag = config.fingerprintHash ? config.fingerprintHash.trim() : `${Date.now()}`;
          const branchName = `pikiland/fix-${hashTag}`;
          const commitMsg = selectedCandidate.prTitle || "fix: automated AI bug patch";

          await this.workspaceAdapter.commitAndPush(
            config.workspacePath,
            branchName,
            commitMsg,
            config.token,
            config.repoName,
            config.gitUserName,
            config.gitUserEmail
          );

          let detailedPrBody = selectedCandidate.prBody || "";
          if (config.fingerprintHash) {
            detailedPrBody += `\n\nPikiLand Incident Fingerprint: ${config.fingerprintHash}`;
          }
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
          } else {
            console.error("GitHub API returned null PR URL");
          }
        } catch (ex: unknown) {
          const err = ex as Error;
          console.error("Failed to create PR for verified candidate:", err);
        }
      } else {
        console.warn("No PR candidates passed harness verification. No PR was created.");
      }
    } else {
      console.log("AI determined no PR fix is required or possible.");
    }

    // 4. Issue Creation if PR was not created and prNeeded is false and issueNeeded is true
    let issueUrl: string | null = null;
    if (!aiResult.prNeeded && prUrls.length === 0 && aiResult.issueNeeded && aiResult.issueTitle && aiResult.issueBody) {
      console.log("Creating GitHub Issue as requested by AI analysis...");
      try {
        let issueBodyWithLog = aiResult.issueBody;
        if (logContent && logContent.trim().length > 0) {
          issueBodyWithLog += `\n\n---\n\n<details>\n<summary>🔍 원본 에러 로그 보기</summary>\n\n\`\`\`\n${logContent}\n\`\`\`\n</details>`;
        }
        issueUrl = await this.githubAdapter.createIssue(
          config.repoName,
          aiResult.issueTitle,
          issueBodyWithLog,
          config.token
        );
        if (issueUrl) {
          console.log(`Successfully created GitHub Issue: ${issueUrl}`);
        }
      } catch (issueErr) {
        console.error("Failed to create GitHub Issue:", issueErr);
      }
    }

    // 5. Slack Notification (Always sent regardless of prNeeded)
    if (config.slackWebhookUrl && config.slackWebhookUrl.trim().length > 0) {
      await this.slackAdapter.sendNotification(
        config.slackWebhookUrl,
        logContent,
        aiResult,
        config.eventType,
        config.repoName,
        config.runId || "cli",
        prUrls,
        issueUrl
      );
    } else {
      console.log("Slack webhook is not set. Diagnostics result:");
      console.log("Summary:", aiResult.summary);
      console.log("Cause:", aiResult.causeDescription);
      console.log("PR Candidates created:", prUrls);
      if (issueUrl) console.log("GitHub Issue created:", issueUrl);
    }
  }
}
