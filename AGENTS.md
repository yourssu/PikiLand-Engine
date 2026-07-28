# AGENTS.md

## 🤖 Overview
Welcome to PikiLand! You are an agent interacting with a system designed to automatically detect, analyze, and patch software errors from GitHub. This project is part of the "PikiLand" ecosystem, which aims to reduce developer on-call burden by providing verified Pull Requests (PRs) for CI failures and GitHub Issues.

## 🛠 Project Core Concepts

### 1. Two Operational Modes
*   **Web App Mode (Coordinator)**: The Spring Boot application that handles webhooks, manages repository settings, and orchestrates the overall flow. It acts as the "brain."
*   **CLI Mode (Execution Engine)**: Runs inside GitHub Actions. This is where the heavy lifting happens: analyzing logs, running tests, applying patches, and executing the **Ralph Loop**.

### 2. The Ralph Loop & Harness
*   **Harness**: A command (e.g., `./gradlew test`) that must be executable in the target repository to reproduce an error (*Red*) and verify a fix (*Green*).
*   **Ralph Loop**: An iterative process where we feed harness failure logs back into an AI model to refine the patch. We repeat this up to a maximum number of retries (`PIKILAND_RALPH_MAX_RETRIES`).

### 3. Data Pipeline: Context Bundles
PikiLand links disparate data points (CI logs, Sentry errors, PostHog events) into a **Context Bundle**. This bundle provides the necessary context for an agent to understand what went wrong and how to fix it.

## 🚦 Guidelines for Agents

### ✅ DO
*   **Read First**: Always read existing files, especially `README.md`, `docs/DESIGN.md`, and `docs/ARCHITECTURE_AND_DATA_PIPELINE.md` before making changes.
*   **Understand the Harness**: If you are working on a feature or fixing a bug, identify the command that serves as the "Harness" for verification.
*   **Verify via Tests**: Never assume a change works. Run the relevant test suite or the specific harness command to ensure the fix is valid and doesn't introduce regressions.
*   **Follow Existing Patterns**: Mimic the existing Java/Spring Boot patterns, directory structures, and coding styles (e.g., use `services`, `controllers`, `repositories` appropriately).
*   **Respect the "Single Best PR" Rule**: PikiLand's goal is to provide only the *single best* verified patch, not dozens of unverified ones. Design features that support this ranking/filtering logic.
*   **Maintain Security**: Never hardcode secrets or expose sensitive log data (PII) in any output or PR description.

### ❌ DO NOT
*   **Do Not Guess**: If a module, class, or configuration is unclear, use `grep` or `glob` to find it or ask the user/advisor for clarification.
*   **Do Not Refactor Without Reason**: Do not clean up surrounding code or change styles unless explicitly requested. Keep changes "surgical."
*   **Do Not Ignore the Ralph Loop**: When implementing automation, ensure you consider how failure logs will be fed back into the loop.
*   **Do Not Create Unverifiable Patches**: Do not suggest or implement logic that bypasses the need for a reproducible harness.

## 📂 Key Directories
*   `src/`: The core Java/Spring Boot source code.
*   `docs/`: Detailed design, architecture, and pipeline documentation.
*   `data/`: Likely used for local storage or data structures (inspect via `ls`).
*   `build.gradle.kts`: Project dependencies and build configuration.

## 🚀 Verification Commands
*Check the `README.md` or `build.gradle.kts` for project-specific test commands.*
Generally:
*   Run architecture tests: `./gradlew test --tests '*ArchitectureTest'`
*   Run log truncation tests: `./gradlew test --tests '*LogTruncatorTest'`

---
*End of AGENTS.md*
