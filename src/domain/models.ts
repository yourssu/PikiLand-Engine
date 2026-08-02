import { z } from "zod";

export const PatchInstructionSchema = z.object({
  filePath: z.string(),
  oldCode: z.string(),
  newCode: z.string(),
});
export type PatchInstruction = z.infer<typeof PatchInstructionSchema>;

export const PrCandidateSchema = z.object({
  patchSummary: z.string(),
  prTitle: z.string(),
  prBody: z.string(),
  patchInstructions: z.array(PatchInstructionSchema),
});
export type PrCandidate = z.infer<typeof PrCandidateSchema>;

export const AiAnalysisResultSchema = z.object({
  isConfident: z.boolean(),
  summary: z.string(),
  impact: z.string(),
  causeDescription: z.string(),
  prNeeded: z.boolean(),
  prCandidates: z.array(PrCandidateSchema),
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
  readonly harnessCmd?: string;
  readonly targetBranch?: string;
  readonly maxRetries: number;
  readonly openAiApiKey?: string;
  readonly anthropicApiKey?: string;
}
