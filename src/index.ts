#!/usr/bin/env bun
import { Command } from "commander";
import { CliConfig } from "./domain/models";
import { SelfHealingService } from "./services/self-healing.service";

function getEnvOrProperty(key: string): string | undefined {
  const val = process.env[key];
  if (val && val.trim().length > 0) {
    return val.trim();
  }
  return undefined;
}

async function main() {
  const program = new Command();
  program
    .name("pikiland-cli")
    .description("PikiLand AI Self-Healing Execution Engine in Bun")
    .option("--cli", "Run in CLI mode")
    .parse(process.argv);

  const options = program.opts();

  const isCliMode = getEnvOrProperty("PIKILAND_CLI") === "true" || options.cli === true;

  if (!isCliMode) {
    console.log("PikiLand CLI Engine mode not activated. Specify --cli or PIKILAND_CLI=true to run.");
    process.exit(0);
  }

  const eventType = getEnvOrProperty("PIKILAND_EVENT_TYPE");
  const logContent = getEnvOrProperty("PIKILAND_LOG_CONTENT") || "";
  const token = getEnvOrProperty("GITHUB_TOKEN");
  const repoName = getEnvOrProperty("GITHUB_REPOSITORY");
  const workspacePath = getEnvOrProperty("PIKILAND_WORKSPACE_PATH") || ".";
  const customModel = getEnvOrProperty("AI_MODEL");
  const customBaseUrl = getEnvOrProperty("PIKILAND_AI_BASE_URL") || getEnvOrProperty("OPENAI_BASE_URL") || getEnvOrProperty("ANTHROPIC_BASE_URL");
  const slackWebhookUrl = getEnvOrProperty("SLACK_WEBHOOK_URL");
  const runId = getEnvOrProperty("PIKILAND_RUN_ID");
  const harnessCmd = getEnvOrProperty("PIKILAND_HARNESS_CMD");
  const targetBranch = getEnvOrProperty("PIKILAND_TARGET_BRANCH");
  const maxRetriesStr = getEnvOrProperty("PIKILAND_RALPH_MAX_RETRIES") || "3";
  const maxRetries = parseInt(maxRetriesStr, 10) || 3;

  const openAiApiKey = getEnvOrProperty("OPENAI_API_KEY");
  const anthropicApiKey = getEnvOrProperty("ANTHROPIC_API_KEY");

  if (!eventType) {
    console.error("Error: PIKILAND_EVENT_TYPE environment variable is required.");
    process.exit(1);
  }
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }
  if (!repoName) {
    console.error("Error: GITHUB_REPOSITORY environment variable is required.");
    process.exit(1);
  }

  const config: CliConfig = {
    eventType,
    logContent,
    token,
    repoName,
    workspacePath,
    customModel,
    customBaseUrl,
    slackWebhookUrl,
    runId,
    harnessCmd,
    targetBranch,
    maxRetries,
    openAiApiKey,
    anthropicApiKey,
  };

  const service = new SelfHealingService();

  try {
    await service.run(config);
    console.log("PikiLand CLI execution completed successfully.");
    process.exit(0);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Fatal error in CLI Execution Engine:", err.message || err);
    process.exit(1);
  }
}

main();
