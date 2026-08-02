import * as fs from "fs/promises";
import * as path from "path";
import { CliConfig, PatchInstruction, PrCandidate } from "../domain/models";
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

    // 3. AI Analysis & Diagnostics
    const aiResult = await this.aiAdapter.analyzeError(config, logContent, config.workspacePath);

    const prUrls: string[] = [];

    if (aiResult.prNeeded && aiResult.prCandidates && aiResult.prCandidates.length > 0) {
      console.log(`AI requested PR. Evaluating ${aiResult.prCandidates.length} candidate(s) for the Single Best PR...`);

      let baseBranch = config.targetBranch;
      if (!baseBranch || baseBranch.trim().length === 0) {
        baseBranch = await this.workspaceAdapter.getCurrentBranch(config.workspacePath);
      }
      if (baseBranch === "HEAD") {
        baseBranch = "main";
      }

      const initialRef = await this.workspaceAdapter.getCurrentBranch(config.workspacePath);
      let bestVerifiedCandidate: PrCandidate | null = null;
      let bestVerifiedPatches: PatchInstruction[] | null = null;

      for (let i = 0; i < aiResult.prCandidates.length; i++) {
        const candidate = aiResult.prCandidates[i];
        if (!candidate) continue;

        let currentPatches = candidate.patchInstructions;
        if (!currentPatches || currentPatches.length === 0) {
          continue;
        }

        const triedPatches: PatchInstruction[][] = [];
        const triedHarnessOutputCounts = new Map<string, number>();
        let candidateSuccess = false;

        const maxRetries = config.maxRetries;

        for (let retry = 0; retry <= maxRetries; retry++) {
          console.log(`[Ralph Loop] Candidate ${i + 1}, Refinement ${retry}/${maxRetries}`);

          try {
            await this.workspaceAdapter.resetToCleanState(config.workspacePath, initialRef);

            const applied = await this.workspaceAdapter.applyPatches(config.workspacePath, currentPatches);
            if (!applied) {
              console.error(`Candidate ${i + 1}: Patches could not be cleanly applied to workspace. Discarding retry.`);
              break;
            }
            triedPatches.push(currentPatches);

            if (!harnessCmd || harnessCmd.trim().length === 0) {
              candidateSuccess = true;
              break;
            }

            console.log(`[Harness] Executing post-patch harness command to verify fix: ${harnessCmd}`);
            const hResAfter = await this.workspaceAdapter.runHarness(config.workspacePath, harnessCmd);

            if (hResAfter.success) {
              console.log(`[Harness] Patch verification SUCCEEDED for candidate ${i + 1} (Tests passed).`);
              candidateSuccess = true;
              break;
            }

            console.error(`[Harness] Patch verification FAILED for candidate ${i + 1} (Tests failed).`);

            if (retry === maxRetries) {
              console.error(`[Ralph Loop] Reached max refinement cap. Discarding candidate ${i + 1}`);
              break;
            }

            const trimmedOutput = this.logTruncator.truncateLogForAi(hResAfter.output, 150);
            const count = (triedHarnessOutputCounts.get(trimmedOutput) || 0) + 1;
            triedHarnessOutputCounts.set(trimmedOutput, count);

            if (count > 2) {
              console.error("[Ralph Loop] Infinite Loop Warning: Same harness output detected again. Aborting refinement.");
              break;
            }

            console.log("[Ralph Loop] Requesting patch refinement from AI agent...");
            const refinedResult = await this.aiAdapter.refinePatch(
              config,
              logContent,
              config.workspacePath,
              currentPatches,
              trimmedOutput
            );

            if (!refinedResult || !refinedResult.prNeeded || !refinedResult.prCandidates || refinedResult.prCandidates.length === 0) {
              console.log("[Ralph Loop] AI decided no further patch is possible.");
              break;
            }

            const nextPatches = refinedResult.prCandidates[0]?.patchInstructions || [];

            if (this.isDuplicatePatch(nextPatches, triedPatches)) {
              console.error("[Ralph Loop] Duplicate Patch Guard: AI proposed an identical patch. Aborting refinement.");
              break;
            }

            currentPatches = this.mergePatches(currentPatches, nextPatches);

          } catch (ex) {
            console.error("Error in refinement iteration:", ex);
            break;
          }
        }

        if (candidateSuccess) {
          console.log(`Candidate ${i + 1} verified successfully. Selected as Single Best PR!`);
          bestVerifiedCandidate = candidate;
          bestVerifiedPatches = currentPatches;
          break;
        }
      }

      // Publish Single Best Verified PR
      if (bestVerifiedCandidate && bestVerifiedPatches) {
        try {
          await this.workspaceAdapter.resetToCleanState(config.workspacePath, initialRef);
          await this.workspaceAdapter.applyPatches(config.workspacePath, bestVerifiedPatches);

          const branchName = `fix/ai-verified-patch-${Date.now()}`;
          const commitMsg = bestVerifiedCandidate.prTitle;

          await this.workspaceAdapter.commitAndPush(config.workspacePath, branchName, commitMsg, config.token, config.repoName);

          let detailedPrBody = bestVerifiedCandidate.prBody || "";
          if (logContent && logContent.trim().length > 0) {
            detailedPrBody += `\n\n---\n\n<details>\n<summary>🔍 원본 에러 로그 및 발생 Context 보기</summary>\n\n\`\`\`\n${logContent}\n\`\`\`\n</details>`;
          }

          const prUrl = await this.githubAdapter.createPullRequest(
            config.repoName,
            bestVerifiedCandidate.prTitle,
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

  private isDuplicatePatch(current: PatchInstruction[], tried: PatchInstruction[][]): boolean {
    return tried.some(past => this.arePatchListsEqual(current, past));
  }

  private arePatchListsEqual(a: PatchInstruction[], b: PatchInstruction[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((pa, idx) => {
      const pb = b[idx];
      return pb && pa.filePath === pb.filePath && pa.oldCode === pb.oldCode && pa.newCode === pb.newCode;
    });
  }

  private mergePatches(base: PatchInstruction[], additions: PatchInstruction[]): PatchInstruction[] {
    const patchMap = new Map<string, PatchInstruction>();
    for (const p of base) {
      patchMap.set(p.filePath, p);
    }
    for (const p of additions) {
      patchMap.set(p.filePath, p);
    }
    return Array.from(patchMap.values());
  }
}
