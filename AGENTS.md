# AGENTS.md

## 🤖 Overview
Welcome to PikiLand Engine! You are an agent interacting with the CLI Execution Engine designed to automatically detect, analyze, and patch software errors from GitHub inside GitHub Actions Runner environments. This project is part of the "PikiLand" ecosystem, which aims to reduce developer on-call burden by providing verified Pull Requests (PRs) for CI failures and GitHub Issues.

## 🛠 Project Core Concepts

### 1. Two Operational Modes
*   **Web App Mode (Coordinator)**: The TypeScript + Bun (Hono) application in `yourssu/PikiLand` that handles webhooks, manages repository settings, and orchestrates the overall flow. It acts as the "brain."
*   **CLI Mode (Execution Engine)**: Resides in this repository (`yourssu/PikiLand-Engine` or `grabic1060/PikiLand-Engine`) and runs inside GitHub Actions. This is where the heavy lifting happens: analyzing logs, running tests, applying patches via OpenCode tools, and executing the **Ralph Loop**.

### 2. The Ralph Loop & Harness
*   **Harness**: A command (e.g., `bun test`, `./gradlew test`, `pytest`, `cargo test`) that must be executable in the target repository to verify a fix (*Green*).
*   **Ralph Loop**: An iterative process where we feed harness failure logs back into an AI model to refine the patch. We repeat this up to a maximum number of retries (`PIKILAND_RALPH_MAX_RETRIES`).

### 3. OpenCode Workspace Tools
PikiLand Engine integrates isolated workspace tools (`read`, `edit`, `write`, `list`, `grep`, `bash`, `manage_task`) allowing AI models to safely inspect the target workspace and apply surgical edits.

## 🚦 Guidelines for Agents

### ✅ DO
*   **Read First**: Always read existing files, especially `README.md`, `docs/DESIGN.md`, and `docs/ARCHITECTURE_AND_DATA_PIPELINE.md` before making changes.
*   **Understand the Harness**: If you are working on a feature or fixing a bug, identify the command that serves as the "Harness" for verification.
*   **Verify via Tests**: Never assume a change works. Run the relevant test suite (`bun test`) or typecheck (`bun run typecheck`) to ensure the fix is valid.
*   **Follow Existing Patterns**: Mimic the existing TypeScript / Bun patterns, directory structures (`src/adapters`, `src/services`, `src/tools`, `src/domain`).
*   **Respect the "Single Best PR" Rule**: PikiLand's goal is to provide only the *single best* verified patch, not dozens of unverified ones.
*   **Maintain Security & Redaction**: Ensure all secrets and sensitive tokens are redacted via `redactSecrets()` and path traversal guards are preserved.

### ❌ DO NOT
*   **Do Not Guess**: If a module, class, or configuration is unclear, use `grep` or `glob` to find it or ask the user for clarification.
*   **Do Not Refactor Without Reason**: Do not clean up surrounding code or change styles unless explicitly requested. Keep changes "surgical."
*   **Do Not Bypass Harness Verification**: Do not suggest or implement logic that bypasses the need for a reproducible harness.

## 📂 Key Directories
*   `src/`: The core TypeScript / Bun CLI source code (`adapters/`, `domain/`, `services/`, `tools/`).
*   `docs/`: Detailed design, architecture, and pipeline documentation.
*   `package.json`: Project dependencies and script configuration.

## 🚀 Verification Commands
*Check `package.json` for project-specific commands.*
Generally:
*   Run tests: `bun test`
*   Run typecheck: `bun run typecheck`
*   Compile binary: `bun run build`

---
*End of AGENTS.md*
