import { z } from "zod";

export const PatchInstructionSchema = z.object({
  filePath: z.string().min(1),
  oldCode: z.string(),
  newCode: z.string(),
});
export type PatchInstruction = z.infer<typeof PatchInstructionSchema>;

export const PrCandidateSchema = z.object({
  patchSummary: z.string().optional(),
  prTitle: z.string().min(1),
  prBody: z.string(),
  patchInstructions: z.array(PatchInstructionSchema),
});
export type PrCandidate = z.infer<typeof PrCandidateSchema>;

export const AiAnalysisResultSchema = z.object({
  isConfident: z.boolean().default(true),
  summary: z.string(),
  impact: z.string().optional(),
  causeDescription: z.string().optional(),
  prNeeded: z.boolean(),
  prCandidates: z.array(PrCandidateSchema).optional(),
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
