# PikiLand Engine (CLI Execution Engine)

PikiLand Engine은 GitHub Actions Runner 내부에서 실행되어 CI 빌드 실패, GitHub Issue, 프로덕션 에러 로그를 분석하고, Harness 기반의 자동 코드 패치 및 검증된 Pull Request(PR)와 Slack 알림을 생성하는 **TypeScript + Bun 기반 고속 자가 치유(Self-Healing) CLI 엔진**입니다.

제품 결정은 [Product Design](docs/DESIGN.md), 전체 목표 구조는 [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md)을 기준으로 합니다.

## 🚀 주요 기능 및 특징

- **단일 최선 패치(Single Best PR)**: 무분별한 여러 개의 PR을 생성하지 않고, Harness 검증을 통과한 단 하나의 최선의 패치만 브랜치 및 PR로 공개합니다.
- **Harness & Ralph Loop**: 테스트 명령어(예: `bun test`, `./gradlew test`, `pytest`, `cargo test` 등)를 통해 AI 패치를 직접 실행하고 검증하며, 실패 시 에러 피드백을 반영해 최대 N회(`PIKILAND_RALPH_MAX_RETRIES`) 재시도 및 보완합니다.
- **OpenCode 격리 워크스페이스 도구 통합**: 안전한 파일 도구(`read`, `edit`, `write`, `list`, `grep`, `bash`, `manage_task`)를 통해 워크스페이스 내에서 AI가 능동적으로 원인을 분석하고 코드를 안전하게 수정합니다.
- **시크릿 마스킹 및 보안 가드**: 민감 토큰(PAT, API Key, Bearer Token)의 자동 마스킹과 워크스페이스 외부 경로 탈출(Path Traversal) 차단 가드를 탑재했습니다.

## 🏗 실행 아키텍처 (Coordinator vs Execution Engine)

PikiLand 생태계는 2가지 모드로 분리되어 협력합니다.

1. **Web App 모드 (Coordinator)**: `yourssu/PikiLand`
   - 지속 실행되는 웹 서버 (TypeScript + Bun + Hono, 포트 `8080`).
   - GitHub 웹훅 수신, EC2 프로비저닝, 대시보드 UI 및 GitHub Actions `workflow_dispatch` 조율 담당.
2. **CLI 모드 (Execution Engine)**: `yourssu/PikiLand-Engine` (본 저장소)
   - GitHub Actions Runner 환경에서 일회성(ephemeral)으로 격리 실행되는 Bun CLI.
   - 코드 분석, 하네스 실행, 코드 수정, Ralph Loop 반복, PR 및 Slack 알림 발행 담당.

## 💻 로컬 개발 및 실행

[Bun](https://bun.sh) 1.2+ 환경이 필요합니다.

```bash
# 의존성 설치
bun install

# CLI 로컬 실행 테스트
bun run ./src/index.ts --cli

# 타입 검사
bun run typecheck

# 단위 테스트 실행
bun test

# 단일 바이너리 빌드 (선택)
bun run build
```

## ⚙️ 주요 환경 변수

| 변수명 | 설명 및 용도 | 필수 여부 |
| --- | --- | :---: |
| `PIKILAND_CLI` | CLI 모드 활성화 플래그 (`true` 또는 `--cli` 플래그) | 필수 |
| `PIKILAND_EVENT_TYPE` | 감지된 이벤트 유형 (`workflow_run`, `issues`, `production_log`) | 필수 |
| `GITHUB_TOKEN` | GitHub API 통신 및 브랜치 푸시/PR 생성을 위한 토큰 | 필수 |
| `GITHUB_REPOSITORY` | 대상 리포지토리명 (`owner/repo`) | 필수 |
| `PIKILAND_LOG_CONTENT` | 분석 대상 에러 로그 또는 이슈 내용 (생략 시 API로 역추적 다운로드) | 선택 |
| `PIKILAND_RUN_ID` | 워크플로 실행 ID 또는 이슈 번호 또는 인시던트 해시 | 선택 |
| `PIKILAND_FINGERPRINT_HASH` | 프로덕션 에러 인시던트 SHA-256 핑거프린트 Hash | 선택 |
| `PIKILAND_HARNESS_CMD` | 테스트 검증을 위한 하네스 실행 명령어 (미지정 시 자동 추론) | 선택 |
| `PIKILAND_RALPH_MAX_RETRIES` | Ralph Loop 최대 재시도 횟수 (기본값: 3) | 선택 |
| `PIKILAND_WORKSPACE_PATH` | 대상 워크스페이스 디렉토리 경로 (기본값: `.`) | 선택 |
| `PIKILAND_SERVER_URL` | Coordinator 서버 주소 (프로덕션 로그 역추적용) | 선택 |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | AI 모델 인증 키 | 선택 |
| `AI_MODEL` | 사용할 AI 모델 (기본값: `gpt-4o`) | 선택 |
| `SLACK_WEBHOOK_URL` | 비개발자용 장애 요약 및 PR 알림 전송 웹훅 URL | 선택 |

### PikiLand Engine 실행 및 연동 계약 (Engine CLI Exit Code & PR Contract)

- **Exit Code 1 종료 계약**: 
  패치 검증 실패, 버그 재현 실패, LLM 연결 에러 또는 Verified PR이 최종 생성되지 못한 경우 PikiLand CLI 엔진은 반드시 `process.exit(1)`로 종료하여 GitHub Actions Workflow 상태를 `failure`로 만듭니다. 이를 통해 PikiLand Web App이 대시보드 에러 인시던트 현황판 상태를 `FAILED`로 자동 반영합니다.
- **PR 브랜치 및 메타데이터 태그 작성 규칙**:
  - 생성 브랜치명 포맷: `pikiland/fix-${fingerprintHash}`
  - PR 본문 메타데이터 태그: `PikiLand Incident Fingerprint: ${fingerprintHash}`
  - 이 메타데이터를 기반으로 PikiLand Web App의 `WebhookAppService`가 Webhook 수신 시 인시던트 상태를 `PR_CREATED` 및 `RESOLVED`로 자동 갱신합니다.

* **`PIKILAND_LOG_CONTENT` (분석 대상 로그)**: 
  AI 모델이 진단할 핵심 데이터입니다. `workflow_run` 실패 시에는 웹앱이 원본 빌드 로그를 가져와 에러 프레임/스택 트레이스 위주로 정제(Log Truncation)한 내용이 주입되며, `issues` 이벤트 시에는 작성된 이슈 본문(Body) 전체가 주입됩니다. 이 데이터는 AI의 프롬프트 입력값으로 사용됩니다.

`.env`와 GitHub App private key는 커밋하지 마세요.

## 검증

일반 테스트:

```bash
bun test
```

## 문서

| 문서 | 답하는 질문                             |
| --- |-----------------------------------------|
| [Product Design](docs/DESIGN.md) | 왜 만들고 무엇을 우선하는가?            |
| [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md) | 어떤 구조와 검증으로 목표를 달성하는가? |
| [Deployment Guide](docs/DEPLOYMENT.md) | 어떻게 배포하고 설정하는가?             |
| [Competitive Research](docs/COMPETITORS.md) | 기존 제품과 무엇이 다른가?              |
| [Future Ideas](docs/FUTURE_IDEAS.md) | MVP 이후 무엇을 다시 검토할 것인가?     |

## 📄 Open Source Licenses & Attributions

PikiLand Engine incorporates open-source file manipulation tools ported from **[OpenCode](https://github.com/anomalyco/opencode)**:
- **Component**: OpenCode File Tools (`read`, `write`, `edit`, `list`, `grep`)
- **Copyright**: Copyright (c) anomalyco/opencode
- **License**: [MIT License](https://opensource.org/licenses/MIT)

