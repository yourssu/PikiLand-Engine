# PikiLand

PikiLand는 GitHub에서 발생한 오류를 분석하고 패치 PR과 Slack 알림을 만드는 GitHub App입니다.

현재 저장소는 **Java 21·Spring Boot 기반 프로토타입**입니다. GitHub Actions 실패와 새 Issue를 감지하고 OpenAI 호환 API로 분석해 최대 3개의 PR을 생성합니다. 목표 제품은 여기서 더 나아가 런타임·사용자 행동 오류까지 수집하고, 실제 재현과 회귀 검증을 통과한 최선의 패치 하나만 공개합니다.

제품 결정은 [Product Design](docs/DESIGN.md), 목표 구조는 [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md)을 기준으로 합니다.

## 현재 구현

- `workflow_run` 실패 및 새 Issue 웹훅 수신
- GitHub 웹훅 서명 검증과 Installation Access Token 발급
- GitHub OAuth 로그인 및 저장소 설정 대시보드
- 로그 정제와 임시 워크스페이스 코드 탐색
- OpenAI 호환 API를 이용한 원인·패치 분석
- 최대 3개의 후보 브랜치와 PR 생성
- 개발자용 PR 설명과 비개발자용 Slack 요약
- H2 로컬 DB와 PostgreSQL 운영 프로필
- ArchUnit 계층 검사와 로그 단위 테스트

## 현재와 목표의 차이

| 항목 | 현재 프로토타입 | M3 목표 |
| --- | --- | --- |
| 입력 | CI 실패, Issue | CI, 런타임 오류, 행동 규칙 위반 |
| AI 실행 | OpenAI 호환 API 키 | 사용자가 선택한 Claude 또는 Codex Provider |
| 후보 처리 | 최대 3개를 검증 없이 각각 PR로 공개 | 내부 검증 후 최선의 하나만 공개 |
| 검증 | 패치 적용 여부 | Harness 기반 Red → Green·회귀 검증 |
| 장시간 작업 | Spring 비동기 실행 | 재시도·복구 가능한 Queue와 Worker |

## 목표 흐름

```text
오류 감지
  → 코드·로그·행동·릴리스 연결
  → 원인과 패치 후보 생성
  → 후보별 재현·수정·회귀 검증
  → 실패 후보 폐기
  → 최선의 패치 하나만 PR로 공개
  → Slack 요약
  → 사람이 최종 머지
```

MVP는 신뢰할 수 있는 Harness와 Ralph Loop가 이미 준비된 저장소를 대상으로 합니다. 패치 전 오류를 재현하지 못하거나 검증을 통과한 후보가 없으면 PR을 만들지 않습니다.

## 실행 모드 (App Mode vs CLI Mode)

PikiLand는 이벤트 조정(Coordinator)과 실제 복구 작업(Worker)이 분리된 2가지 모드로 동작합니다.

### 1. Web App 모드 (Coordinator)
* **목적**: 사용자 제어 및 GitHub 웹훅 이벤트 연동
* **실행 환경**: 지속 실행되는 **웹 서버** (Spring Boot Web, 포트 `8080`) *<- 포트 변경 필요*
* **동작 흐름**:
  1. GitHub 웹훅 이벤트(`workflow_run` 실패, `issues` 등록)를 수신합니다.
  2. 에러 로그를 다운로드하여 요약 및 정제합니다.
  3. 대상 저장소에 자가 치유용 워크플로 파일(`.github/workflows/pikiland.yml`)이 없다면 자동으로 커밋/설치합니다.
  4. 대상 저장소의 GitHub Actions Runner를 깨우기 위해 `workflow_dispatch`를 발생시킵니다.

### 2. CLI 모드 (Execution Engine)
* **목적**: 격리된 환경에서의 코드 분석, 빌드 테스트 및 패치/PR 생성
* **실행 환경**: **GitHub Actions Runner** (단발성 Native Java 21 Batch 실행)
  * Web App에 의해 연동 리포지토리의 GitHub Actions가 트리거되면, Runner 환경 내에서 Native Java 21로 direct 실행됩니다. (`./gradlew bootRun --args="--cli"`)
* **동작 흐름**:
  1. 대상 코드를 체크아웃하고 `AGENTS.md` 또는 `AI.md` 안전장치 파일이 있는지 확인합니다.
  2. 사전 빌드(Harness) 실행으로 버그를 재현하고, AI API를 사용해 패치 후보를 진단합니다.
  3. 코드를 직접 수정하며 다시 빌드(Harness)하여 검증하는 자가 보완 루프(Ralph Loop)를 돕니다.
  4. 최종 통과된 패치에 대한 신규 브랜치 및 Pull Request를 생성하고 Slack 알림을 보냅니다.

## 로컬 실행

Java 21이 필요합니다.

```bash
cp .env.example .env
# .env 파일 작성 후 실행
./gradlew bootRun --args='--spring.profiles.active=local'
```

실행 후 `http://localhost:8080`에서 GitHub OAuth 로그인과 저장소 설정 화면을 확인할 수 있습니다.

주요 환경 변수:

| 변수 | 용도 |
| --- | --- |
| `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` | OpenAI 및 Anthropic API Gateway Base URL |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | OpenAI 및 Anthropic API 인증 키 |
| `AI_MODEL` | AI 진단 및 분석 시 사용할 기본 AI 모델 (기본값: `gpt-4o`) |
| `PIKILAND_HARNESS_CMD` | 테스트 재현 및 검증을 위한 로컬 Harness 실행 명령 |
| `PIKILAND_RALPH_MAX_RETRIES` | Ralph Loop 최대 재시도 횟수 (기본값: 3) |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH` | GitHub App 인증 |
| `GITHUB_WEBHOOK_SECRET` | 웹훅 서명 검증 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | 대시보드 로그인용 GitHub OAuth 인증 (최초 접속 데드락 방지) |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | 운영 PostgreSQL |
| `DRY_RUN` | 로컬 테스트 우회 설정. 운영에서는 반드시 `false` |

### 테스트 하네스 및 Ralph Loop 설정

- **`PIKILAND_HARNESS_CMD` (하네스 실행 명령)**: 
  자가 치유 단계에서 로컬 테스트를 실행하기 위한 명령어입니다 (예: `./gradlew test`). 이 명령어가 설정되면 PikiLand는 AI 분석 전 테스트가 정상적으로 실패하여 버그가 재현되는지 먼저 확인(Pre-patch gate)하며, 패치 적용 후에는 테스트가 성공하는지 검증(Post-patch gate)합니다.
- **`PIKILAND_RALPH_MAX_RETRIES` (최대 보완 횟수)**: 
  적용한 패치가 테스트 하네스를 통과하지 못했을 때, 테스트 실패 로그를 AI 모델에 다시 피드백하여 패치를 보완하는 Ralph Loop의 최대 재시도 횟수입니다 (기본값: 3). 중복 제안 방지(Duplicate Patch Guard)와 로그 변화 감지를 통해 무한 루프를 방지합니다.

### CLI 및 GitHub Actions 환경 변수

이 변수들은 GitHub Actions Runner(워크플로 실행 환경)에서 자동으로 주입되어 PikiLand CLI 모드 실행에 사용됩니다.

| 변수 | 용도 및 설명 | 필수 여부 |
| --- | --- | :---: |
| `PIKILAND_CLI` | PikiLand를 CLI 모드로 실행하기 위한 활성화 플래그 | 필수 |
| `PIKILAND_EVENT_TYPE` | 워크플로가 감지한 원래 이벤트 유형 (예: `workflow_run`, `issues`) | 필수 |
| `PIKILAND_LOG_CONTENT` | 분석 대상이 될 정제된 에러 로그 또는 이슈 내용 | 필수 |
| `GITHUB_TOKEN` | GitHub API 통신 및 PR 생성을 위한 권한 토큰 | 필수 |
| `GITHUB_REPOSITORY` | 대상 리포지토리명 (형식: `owner/repo`) | 필수 |
| `PIKILAND_WORKSPACE_PATH` | 코드 분석 및 패치를 적용할 대상 워크스페이스 디렉토리 경로 (기본값: `.`) | 선택 |
| `PIKILAND_RUN_ID` | 해당 분석 실행에 매핑되는 워크플로 실행 ID 또는 이슈 번호 | 선택 |
| `PIKILAND_TARGET_BRANCH` | 패치를 적용하여 PR을 제출할 타겟 브랜치 | 선택 |
| `GITHUB_REF_NAME` | 타겟 브랜치의 Fallback (기본 브랜치명) | 선택 |
| `SLACK_WEBHOOK_URL` | 결과를 전송할 Slack Webhook 수신자 URL | 선택 |

* **`PIKILAND_LOG_CONTENT` (분석 대상 로그)**: 
  AI 모델이 진단할 핵심 데이터입니다. `workflow_run` 실패 시에는 웹앱이 원본 빌드 로그를 가져와 에러 프레임/스택 트레이스 위주로 정제(Log Truncation)한 내용이 주입되며, `issues` 이벤트 시에는 작성된 이슈 본문(Body) 전체가 주입됩니다. 이 데이터는 AI의 프롬프트 입력값으로 사용됩니다.

`.env`와 GitHub App private key는 커밋하지 마세요.

## 검증

일반 테스트:

```bash
./gradlew clean test 
```

## 문서

| 문서 | 답하는 질문                             |
| --- |-----------------------------------------|
| [Product Design](docs/DESIGN.md) | 왜 만들고 무엇을 우선하는가?            |
| [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md) | 어떤 구조와 검증으로 목표를 달성하는가? |
| [Deployment Guide](docs/DEPLOYMENT.md) | 어떻게 배포하고 설정하는가?             |
| [Competitive Research](docs/COMPETITORS.md) | 기존 제품과 무엇이 다른가?              |
| [Future Ideas](docs/FUTURE_IDEAS.md) | MVP 이후 무엇을 다시 검토할 것인가?     |
