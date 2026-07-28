package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.HarnessResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.model.PrCandidate;
import com.yourssu.pikiland.domain.port.AiAgentPort;
import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.yourssu.pikiland.domain.port.NotifierPort;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import com.yourssu.pikiland.domain.service.LogTruncator;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class SelfHealingCliService {

    private final WorkspacePort workspacePort;
    private final AiAgentPort openAiAdapter;
    private final AiAgentPort anthropicAdapter;
    private final NotifierPort notifierPort;
    private final GithubAuthPort githubAuthPort;
    private final LogTruncator logTruncator;
    private final HarnessInferenceService harnessInferenceService;

    public SelfHealingCliService(WorkspacePort workspacePort,
                                  @Qualifier("openAiAdapter") AiAgentPort openAiAdapter,
                                  @Qualifier("anthropicAdapter") AiAgentPort anthropicAdapter,
                                  NotifierPort notifierPort,
                                  GithubAuthPort githubAuthPort,
                                  LogTruncator logTruncator,
                                  HarnessInferenceService harnessInferenceService) {
        this.workspacePort = workspacePort;
        this.openAiAdapter = openAiAdapter;
        this.anthropicAdapter = anthropicAdapter;
        this.notifierPort = notifierPort;
        this.githubAuthPort = githubAuthPort;
        this.logTruncator = logTruncator;
        this.harnessInferenceService = harnessInferenceService;
    }

    public void run() {
        String eventType = getEnvOrProperty("PIKILAND_EVENT_TYPE");
        String logContent = getEnvOrProperty("PIKILAND_LOG_CONTENT");
        String token = getEnvOrProperty("GITHUB_TOKEN");
        String repoName = getEnvOrProperty("GITHUB_REPOSITORY");
        String workspacePathStr = getEnvOrProperty("PIKILAND_WORKSPACE_PATH");
        String customModel = getEnvOrProperty("AI_MODEL");
        String slackWebhookUrl = getEnvOrProperty("SLACK_WEBHOOK_URL");
        String runId = getEnvOrProperty("PIKILAND_RUN_ID");

        if (eventType == null || eventType.isBlank()) {
            throw new IllegalArgumentException("PIKILAND_EVENT_TYPE environment variable is required.");
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("GITHUB_TOKEN environment variable is required.");
        }
        if (repoName == null || repoName.isBlank()) {
            throw new IllegalArgumentException("GITHUB_REPOSITORY environment variable is required.");
        }

        // If PIKILAND_LOG_CONTENT was omitted or empty (e.g. to bypass GitHub Workflow Dispatch 1000-char input limit),
        // download logs or issue body dynamically using PIKILAND_RUN_ID.
        if (logContent == null || logContent.isBlank()) {
            if (runId == null || runId.isBlank()) {
                throw new IllegalArgumentException("Either PIKILAND_LOG_CONTENT or a valid PIKILAND_RUN_ID is required.");
            }
            if ("workflow_run".equals(eventType)) {
                System.out.println("[CLI] Log content omitted. Downloading workflow logs for Run ID: " + runId + " in " + repoName);
                String rawLogs = githubAuthPort.downloadWorkflowLogs(repoName, runId, token);
                logContent = logTruncator.truncateLogForAi(rawLogs, 300);
            } else if ("issues".equals(eventType)) {
                System.out.println("[CLI] Log content omitted. Fetching issue body for Issue #" + runId + " in " + repoName);
                logContent = githubAuthPort.fetchIssueBody(repoName, runId, token);
            }
        }

        if (logContent == null || logContent.isBlank()) {
            throw new IllegalArgumentException("Failed to acquire log content or issue body for event: " + eventType + ", run_id: " + runId);
        }

        Path workspace = Paths.get(workspacePathStr != null && !workspacePathStr.isBlank() ? workspacePathStr : ".");

        System.out.println("Starting CLI Self-Healing for " + repoName + " on workspace: " + workspace.toAbsolutePath());

        // --- 1. Safety Check: Verify presence of AGENTS.md or AI.md ---
        boolean agentsFileExists = false;
        String[] allowedAgentFiles = {"AGENTS.md", "agents.md", ".agents.md", "AI.md", "ai.md"};
        for (String filename : allowedAgentFiles) {
            if (Files.exists(workspace.resolve(filename))) {
                agentsFileExists = true;
                break;
            }
        }
        if (!agentsFileExists) {
            System.err.println("PikiLand execution DENIED: No 'AGENTS.md' or 'AI.md' file found in the root of the repository.");
            System.err.println("To allow PikiLand to run, please create an 'AGENTS.md' file in the root of your repository.");
            throw new IllegalStateException("Execution denied: Missing AGENTS.md or AI.md safety file.");
        }
        System.out.println("Safety check passed: AGENTS.md or AI.md file found.");

        // --- 2. Pre-patch Harness Check (Reproduction Gate) ---
        String harnessCmd = getEnvOrProperty("PIKILAND_HARNESS_CMD");
        if ((harnessCmd == null || harnessCmd.isBlank()) && harnessInferenceService != null) {
            harnessCmd = harnessInferenceService.inferHarnessCmdFromWorkspace(workspace);
            if (harnessCmd != null && !harnessCmd.isBlank()) {
                System.out.println("[Harness] Smart runtime-inferred harness command for workspace: " + harnessCmd);
            }
        }

        if (harnessCmd != null && !harnessCmd.isBlank()) {
            System.out.println("[Harness] Executing pre-patch harness command to reproduce the issue: " + harnessCmd);
            HarnessResult hResBefore = workspacePort.runHarness(workspace, harnessCmd);
            if (hResBefore.isSuccess()) {
                System.err.println("[Harness] Bug reproduction FAILED: Tests passed on buggy workspace (Red verification failed).");
                System.err.println("[Harness] Discarding patching process as the issue is not reproducible.");
                return;
            }
            System.out.println("[Harness] Bug reproduction SUCCEEDED: Tests failed as expected on buggy workspace. Proceeding to patch generation.");
        }

        // Custom AI Base URL injection if provided
        String customBaseUrl = getEnvOrProperty("PIKILAND_AI_BASE_URL");
        if (customBaseUrl != null && !customBaseUrl.isBlank()) {
            System.out.println("[AI Gateway] Using Custom Base URL: " + customBaseUrl);
        }

        // Dynamic AI Agent Selection
        String openAiKey = getEnvOrProperty("OPENAI_API_KEY");
        String anthropicKey = getEnvOrProperty("ANTHROPIC_API_KEY");
        AiAgentPort selectedAgent;

        if ((anthropicKey != null && !anthropicKey.isBlank()) || (customModel != null && customModel.toLowerCase().contains("claude"))) {
            if (customModel != null && customModel.toLowerCase().contains("claude")) {
                selectedAgent = anthropicAdapter;
                System.out.println("Selected Anthropic Adapter (for model: " + customModel + ")");
            } else if (openAiKey != null && !openAiKey.isBlank()) {
                selectedAgent = openAiAdapter;
                System.out.println("Selected OpenAI Adapter (based on OPENAI_API_KEY)");
            } else {
                selectedAgent = anthropicAdapter;
                System.out.println("Selected Anthropic Adapter (based on ANTHROPIC_API_KEY)");
            }
        } else if ((openAiKey != null && !openAiKey.isBlank()) || (customBaseUrl != null && !customBaseUrl.isBlank())) {
            selectedAgent = openAiAdapter;
            System.out.println("Selected OpenAI Adapter (based on key/custom base URL)");
        } else {
            throw new IllegalStateException("Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY nor custom base URL is configured in the environment.");
        }

        try {
            // Run AI Diagnostic Loop
            AiAnalysisResult aiResult = selectedAgent.analyzeError(
                logContent,
                eventType,
                workspace,
                workspacePort,
                customModel
            );

            List<String> prUrls = new ArrayList<>();
            if (aiResult.isPrNeeded() && aiResult.getPrCandidates() != null && !aiResult.getPrCandidates().isEmpty()) {
                System.out.println("AI requested PR. Evaluating " + aiResult.getPrCandidates().size() + " candidate(s) for the Single Best PR...");

                // Detect base branch name
                String baseBranch = System.getenv("PIKILAND_TARGET_BRANCH");
                if (baseBranch == null || baseBranch.isBlank()) {
                    baseBranch = System.getenv("GITHUB_REF_NAME");
                }
                if (baseBranch == null || baseBranch.isBlank() || "HEAD".equals(baseBranch)) {
                    baseBranch = workspacePort.getCurrentBranch(workspace);
                }
                if ("HEAD".equals(baseBranch)) {
                    baseBranch = "main";
                }
                System.out.println("Base branch for PRs: " + baseBranch);

                String initialRef = workspacePort.getCurrentBranch(workspace);
                PrCandidate bestVerifiedCandidate = null;
                List<PatchInstruction> bestVerifiedPatches = null;

                for (int i = 0; i < aiResult.getPrCandidates().size(); i++) {
                    PrCandidate candidate = aiResult.getPrCandidates().get(i);
                    List<PatchInstruction> currentPatches = candidate.getPatchInstructions();
                    if (currentPatches == null || currentPatches.isEmpty()) {
                        System.out.println("Candidate " + (i + 1) + " has empty patch instructions. Skipping.");
                        continue;
                    }

                    List<List<PatchInstruction>> triedPatches = new ArrayList<>();
                    Map<String, Integer> triedHarnessOutputCounts = new HashMap<>();

                    int rRetries = 3;
                    String maxRetriesStr = getEnvOrProperty("PIKILAND_RALPH_MAX_RETRIES");
                    if (maxRetriesStr != null && !maxRetriesStr.isBlank()) {
                        try {
                            rRetries = Integer.parseInt(maxRetriesStr.trim());
                        } catch (NumberFormatException e) {
                            // fallback to 3
                        }
                    }

                    boolean candidateSuccess = false;
                    System.out.println("Evaluating candidate " + (i + 1) + "...");

                    for (int retry = 0; retry <= rRetries; retry++) {
                        System.out.println("[Ralph Loop] Candidate " + (i + 1) + ", Refinement " + retry + "/" + rRetries);

                        try {
                            // Reset workspace to clean state
                            workspacePort.resetToCleanState(workspace, initialRef);

                            // Apply current patches
                            boolean applied = workspacePort.applyPatches(workspace, currentPatches);
                            if (!applied) {
                                System.err.println("Candidate " + (i + 1) + ": Patches could not be cleanly applied to workspace. Discarding retry.");
                                break;
                            }
                            triedPatches.add(currentPatches);

                            // Execute harness
                            if (harnessCmd == null || harnessCmd.isBlank()) {
                                candidateSuccess = true;
                                break;
                            }

                            System.out.println("[Harness] Executing post-patch harness command to verify fix: " + harnessCmd);
                            HarnessResult hResAfter = workspacePort.runHarness(workspace, harnessCmd);

                            if (hResAfter.isSuccess()) {
                                System.out.println("[Harness] Patch verification SUCCEEDED for candidate " + (i + 1) + " (Tests passed successfully).");
                                candidateSuccess = true;
                                break;
                            }

                            System.err.println("[Harness] Patch verification FAILED for candidate " + (i + 1) + " (Tests failed or regressions found).");

                            if (retry == rRetries) {
                                System.err.println("[Ralph Loop] Reached max refinement cap. Discarding candidate " + (i + 1));
                                break;
                            }

                            // Capture and truncate output logs using LogTruncator (Head + Tail + Error Context)
                            String rawOutput = hResAfter.getOutput();
                            if (rawOutput == null) {
                                rawOutput = "";
                            }
                            String trimmedOutput = logTruncator.truncateLogForAi(rawOutput, 150);

                            // Infinite loop check: allow 1 extra chance when duplicate output log detected
                            int outputCount = triedHarnessOutputCounts.getOrDefault(trimmedOutput, 0) + 1;
                            triedHarnessOutputCounts.put(trimmedOutput, outputCount);
                            if (outputCount > 2) {
                                System.err.println("[Ralph Loop] Infinite Loop Warning: Same harness output detected again after retry chance. Aborting refinement.");
                                break;
                            } else if (outputCount == 2) {
                                System.out.println("[Ralph Loop] Same harness output detected. Giving AI 1 extra chance to refine...");
                            }

                            // Call refinePatch to get a new set of instructions
                            System.out.println("[Ralph Loop] Requesting patch refinement from AI agent...");
                            AiAnalysisResult refinedResult = selectedAgent.refinePatch(
                                    logContent,
                                    eventType,
                                    workspace,
                                    workspacePort,
                                    customModel,
                                    currentPatches,
                                    trimmedOutput
                            );

                            if (refinedResult == null || !refinedResult.isPrNeeded() || refinedResult.getPrCandidates() == null || refinedResult.getPrCandidates().isEmpty()) {
                                System.out.println("[Ralph Loop] AI decided no further patch is possible.");
                                break;
                            }

                            List<PatchInstruction> nextPatches = refinedResult.getPrCandidates().get(0).getPatchInstructions();

                            // Infinite loop check: duplicate patch candidate check (Duplicate Patch Guard)
                            if (isDuplicatePatch(nextPatches, triedPatches)) {
                                System.err.println("[Ralph Loop] Duplicate Patch Guard: AI proposed an identical patch. Aborting refinement.");
                                break;
                            }

                            currentPatches = nextPatches;

                        } catch (Exception ex) {
                            System.err.println("Error in refinement iteration: " + ex.getMessage());
                            ex.printStackTrace();
                            break;
                        }
                    }

                    if (candidateSuccess) {
                        System.out.println("Candidate " + (i + 1) + " verified successfully. Selected as the Single Best PR!");
                        bestVerifiedCandidate = candidate;
                        bestVerifiedPatches = currentPatches;
                        // Single Best PR rule: Stop checking remaining candidates once a verified fix is found
                        break;
                    }
                }

                // Publish only the Single Best Verified PR
                if (bestVerifiedCandidate != null) {
                    try {
                        // Ensure workspace has the best verified patch applied
                        workspacePort.resetToCleanState(workspace, initialRef);
                        workspacePort.applyPatches(workspace, bestVerifiedPatches);

                        String branchName = "fix/ai-verified-patch-" + System.currentTimeMillis();
                        String commitMsg = bestVerifiedCandidate.getPrTitle();

                        workspacePort.commitAndPush(workspace, branchName, commitMsg, token, repoName);

                        String detailedPrBody = bestVerifiedCandidate.getPrBody() != null ? bestVerifiedCandidate.getPrBody() : "";
                        if (logContent != null && !logContent.isBlank()) {
                            detailedPrBody += "\n\n---\n\n<details>\n<summary>🔍 원본 에러 로그 및 발생 Context 보기</summary>\n\n```\n" + logContent + "\n```\n</details>";
                        }

                        String prUrl = githubAuthPort.createPullRequest(
                            repoName,
                            bestVerifiedCandidate.getPrTitle(),
                            detailedPrBody,
                            branchName,
                            baseBranch,
                            token
                        );

                        if (prUrl != null) {
                            prUrls.add(prUrl);
                            System.out.println("Successfully created Single Best Verified PR: " + prUrl);
                        }
                    } catch (Exception ex) {
                        System.err.println("Failed to create PR for verified candidate: " + ex.getMessage());
                        ex.printStackTrace();
                    }
                } else {
                    System.out.println("No PR candidates passed harness verification. No PR was created (Zero PR noise policy).");
                }
            }

            // Slack Notification
            if (slackWebhookUrl != null && !slackWebhookUrl.isBlank()) {
                notifierPort.sendNotification(
                    slackWebhookUrl,
                    logContent,
                    aiResult,
                    eventType,
                    repoName,
                    runId != null ? runId : "cli",
                    prUrls
                );
            } else {
                System.out.println("Slack webhook is not set. Diagnostics result:");
                System.out.println("Summary: " + aiResult.getSummary());
                System.out.println("PR Candidates created: " + prUrls);
            }

        } catch (Exception e) {
            System.err.println("Fatal error in CLI Self-Healing: " + e.getMessage());
            e.printStackTrace();
            if (slackWebhookUrl != null && !slackWebhookUrl.isBlank()) {
                notifierPort.sendErrorNotification(
                        slackWebhookUrl,
                        repoName,
                        e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()
                );
            }
            throw new RuntimeException(e);
        }
    }

    private boolean isDuplicatePatch(List<PatchInstruction> current, List<List<PatchInstruction>> tried) {
        for (List<PatchInstruction> past : tried) {
            if (arePatchListsEqual(current, past)) {
                return true;
            }
        }
        return false;
    }

    private boolean arePatchListsEqual(List<PatchInstruction> a, List<PatchInstruction> b) {
        if (a.size() != b.size()) {
            return false;
        }
        for (int i = 0; i < a.size(); i++) {
            PatchInstruction pa = a.get(i);
            PatchInstruction pb = b.get(i);
            if (!java.util.Objects.equals(pa.getFilePath(), pb.getFilePath())
                    || !java.util.Objects.equals(pa.getOldCode(), pb.getOldCode())
                    || !java.util.Objects.equals(pa.getNewCode(), pb.getNewCode())) {
                return false;
            }
        }
        return true;
    }



    private String getEnvOrProperty(String key) {
        String val = System.getenv(key);
        if (val == null || val.isBlank()) {
            val = System.getProperty(key);
        }
        return val;
    }
}
