import { z } from "zod";

export const AiAnalysisResultSchema = z.object({
  isConfident: z.boolean().describe("Whether AI is confident in analysis"),
  summary: z.string().describe("Easy non-technical summary of the issue for Slack"),
  impact: z.string().describe("Impact of the issue for non-technical users"),
  causeDescription: z.string().describe("Technical cause description for developers"),
  prNeeded: z.boolean().describe("Whether a PR fix is required and possible"),
  prTitle: z.string().nullable().describe("GitHub PR title for developers (set null when prNeeded is false)"),
  prBody: z.string().nullable().describe("Detailed markdown PR body for developers explaining cause and fix (set null when prNeeded is false)"),
  prNotNeededReason: z.string().nullable().describe("Reason why PR fix is not needed or not possible (set null when prNeeded is true)"),
  issueNeeded: z.boolean().nullable().describe("Whether a GitHub Issue should be created (evaluated when prNeeded is false, set null when prNeeded is true)"),
  issueTitle: z.string().nullable().describe("Title for GitHub Issue if issueNeeded is true, otherwise null"),
  issueBody: z.string().nullable().describe("Detailed markdown body for GitHub Issue if issueNeeded is true, otherwise null"),
});
export type AiAnalysisResult = z.infer<typeof AiAnalysisResultSchema>;

export interface HarnessResult {
  readonly success: boolean;
  readonly output: string;
  readonly exitCode: number;
}

export interface CliConfig {
  readonly eventType: string;
  readonly logContent: string;
  readonly token: string;
  readonly repoName: string;
  readonly workspacePath: string;
  readonly customModel?: string;
  readonly customBaseUrl?: string;
  readonly slackWebhookUrl?: string;
  readonly runId?: string;
  readonly fingerprintHash?: string;
  readonly harnessCmd?: string;
  readonly targetBranch?: string;
  readonly maxRetries: number;
  readonly pikilandServerUrl?: string;
  readonly openAiApiKey?: string;
  readonly anthropicApiKey?: string;
  readonly gitUserName?: string;
  readonly gitUserEmail?: string;
}
