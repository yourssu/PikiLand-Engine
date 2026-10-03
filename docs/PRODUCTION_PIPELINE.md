# Production-only verification contract

This document supersedes older workflow-failure / Issue-input descriptions. The engine still runs in GitHub Actions, but `PIKILAND_EVENT_TYPE` must be `production_log`. Issue creation as a diagnostic output and configured Slack notifications remain supported; Issue creation never triggers another analysis.

## Flow and safety boundaries

1. Fetch bounded incident evidence over verified HTTPS from the coordinator, authenticated with the runner's GitHub token. The coordinator validates repository write permission with GitHub (token prefixes alone are not authentication).
2. Verify the evidence repository and incident identity. Incomplete observations produce `NEEDS_EVIDENCE`.
3. Diagnose with read/list/grep tools only. Log contents are untrusted data. No edit, shell, or process-management tools are exposed during diagnosis.
4. Load a **tracked, maintainer-authored** `.pikiland/production-verification.json` from a clean checkout. No policy, unknown rule, or missing approved test means no patch/PR.
5. Run the registered reproduction command. Require its configured nonzero exit code **and assertion marker**. A generic compiler failure or passing suite is not reproduction.
6. Allow AI edits only in approved production source paths. Tests, fixtures, dependency files, hidden files, and explicit protected paths are immutable. Shell/process tools are not exposed to the patch agent either; the engine runs verification.
7. Require the reproduction command and regression command to pass after the patch, and recheck protected tracked files and every changed/untracked path. Refine at most three times.
8. Publish only verified source files. Never force-push. Check for an existing open PR on the incident branch before publication. Report the outcome to the coordinator.

The runner must be isolated and must not contain production credentials, network access to production databases, or tests that call production services. Approved commands run repository code; file guards are not a container/network sandbox. Use synthetic fixtures or an isolated test environment.

## Verification policy

The policy is not generated from production logs and is not supplied as a workflow input. Example shape (commands/files must actually exist in the target repository):

```json
{
  "version": 1,
  "service": "web",
  "route": "catalog",
  "ruleIds": ["response_contract"],
  "expectedBehavior": "The fixture endpoint returns its nonempty documented response",
  "reproductionCommand": "bun run tests/reproduce-response.ts",
  "regressionCommand": "bun run test",
  "failureMarker": "EXPECTED_RESPONSE_MISSING",
  "failureExitCode": 1,
  "allowedSourcePaths": ["src"],
  "protectedPaths": ["tests"]
}
```

`protectedPaths` must refer to tracked files/directories and should cover the reproduction oracle and fixtures. The policy itself and every tracked file outside allowed source paths are hashed, including mode changes. New files outside scope and symlink patches are rejected. The service and route label must exactly match the observation; a test for another endpoint cannot authorize a patch. The assertion marker must identify the incident-specific oracle, not a generic `FAIL` string. Business correctness cannot be inferred from access logs; maintainers must define the expected behavior independently of the implementation.

Supported coordinator rule IDs: `http_5xx`, `redirect_shift`, `empty_response_shift`, `response_contract`, `latency_contract`. Legacy redacted application logs use `explicit_error`. An unknown rule is diagnostic-only.

## Inputs and outcomes

- `PIKILAND_EVENT_TYPE=production_log`
- `PIKILAND_RUN_ID`: 64-character production incident hash (not a workflow run ID)
- `PIKILAND_SERVER_URL`: HTTPS coordinator origin
- `GITHUB_REPOSITORY`, `GITHUB_TOKEN`: target repository and authorized token
- `PIKILAND_WORKSPACE_PATH`: clean, isolated target checkout
- `PIKILAND_TARGET_BRANCH`: PR base; default `main`
- AI provider settings remain unchanged. `PIKILAND_LOG_CONTENT` and generic harness inference do not bypass the production verification policy.

Results: `PR_CREATED`, `NO_PR`, `NEEDS_EVIDENCE`, `FAILED`. The result API changes an existing job only. PR merge means awaiting deployment, not confirmed recovery. Default access logs have no deployed commit SHA; the engine proves the defect on its checked-out source, not that this source is what production is running.

## Validation

`bun run test` and `bun run typecheck` cover input rejection, protected oracle integrity, assertion-specific reproduction, regression checks, and evidence binding. The coordinator's `scripts/test-production-contract.ts` exercises the real observer, HTTP ingestion, durable job, this engine, real temporary Git checkout, failing/passing reproduction and callback; only AI and GitHub publishing are mocked.

No live provider, production host, hosted Actions run, deployment, or automatic merge is part of local validation. Merge/release this companion engine before enabling the new coordinator collector.
