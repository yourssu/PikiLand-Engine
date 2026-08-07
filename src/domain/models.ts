import { z } from "zod";

export const PrCandidateSchema = z.object({
  patchSummary: z.string().describe("Description of what this PR patch does"),
  prTitle: z.string().describe("GitHub PR title for developers"),
  prBody: z.string().describe("Detailed technical explanation of the fix for developers"),
});
export type PrCandidate = z.infer<typeof PrCandidateSchema>;

export const AiAnalysisResultSchema = z.object({
  isConfident: z.boolean().describe("Whether AI is confident in analysis"),
  summary: z.string().describe("Easy non-technical summary of the issue for Slack"),
  impact: z.string().describe("Impact of the issue for non-technical users"),
  causeDescription: z.string().describe("Technical cause description for developers"),
  prNeeded: z.boolean().describe("Whether a PR fix is required and possible"),
  prNotNeededReason: z.string().nullable().optional().describe("Reason why PR fix is not needed or not possible (when prNeeded is false)"),
  issueNeeded: z.boolean().nullable().optional().describe("Whether a GitHub Issue should be created (evaluated when prNeeded is false)"),
  issueTitle: z.string().nullable().optional().describe("Title for GitHub Issue if issueNeeded is true"),
  issueBody: z.string().nullable().optional().describe("Detailed markdown body for GitHub Issue if issueNeeded is true"),
  prCandidates: z.array(PrCandidateSchema).describe("List of PR candidates proposed by AI"),
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
  readonly openAiApiKey?: string;
  readonly anthropicApiKey?: string;
  readonly gitUserName?: string;
  readonly gitUserEmail?: string;
}
