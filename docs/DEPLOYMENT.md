# PikiLand Deployment & Integration Guide

> 마지막 수정: 2026-07-28
> 이 문서는 PikiLand 서버를 처음부터 배포하고, GitHub App을 등록하여 대상 저장소에 연동하는 전 과정을 설명합니다.

---

## 0. 전체 아키텍처

```text
[ GitHub Webhooks / OAuth ]
          │
          │ HTTPS:443
          ▼
 ┌─────────────────────────────────────────────────────┐
 │     Nginx Reverse Proxy (SSL/TLS)                   │
 │     - TLS Termination  - X-Forwarded-* 헤더 주입    │
 └───────────────────────┬─────────────────────────────┘
                         │ HTTP:8080
                         ▼
 ┌─────────────────────────────────────────────────────┐
 │  Docker: pikiland-server (Spring Boot 3.3 / JDK 21) │
 │  - OAuth2 Login (GitHub)                            │
 │  - Webhook 수신 & 이벤트 큐                          │
 │  - pikiland.yml 자동 삽입                            │
 │  - 대시보드 & 어드민 UI                              │
 └───────────────────────┬─────────────────────────────┘
                         │ JDBC:5432
                         ▼
 ┌─────────────────────────────────────────────────────┐
 │  Docker: pikiland-postgres (PostgreSQL)             │
 └─────────────────────────────────────────────────────┘
                         │ GitHub Actions (워크플로 트리거)
                         ▼
 ┌─────────────────────────────────────────────────────┐
 │  Target Repository: .github/workflows/pikiland.yml  │
 │  - PikiLand Engine (CLI) 체크아웃 & 실행            │
 │  - Harness 검증 (Ralph Loop)                        │
 │  - 패치 브랜치 Push → PR 생성                       │
 └─────────────────────────────────────────────────────┘
```

> **두 가지 실행 모드**
> - **Web App (Coordinator)**: 이 저장소(`username/PikiLand`). 웹훅 수신, GitHub App 인증, 대시보드 UI, 워크플로 트리거를 담당합니다.
> - **CLI (Engine)**: 별도 저장소(`username/PikiLand-Engine`). GitHub Actions에서 실행되어 AI 분석, Ralph Loop, 패치 적용, PR 생성을 수행합니다.

---

## 1. 사전 요구사항

| 항목 | 최소 사양 |
|------|-----------|
| OS | Ubuntu 22.04 LTS 이상 (또는 Docker 지원 환경) |
| Docker | 24.x 이상 |
| Docker Compose | v2.x 이상 (`docker compose` 명령) |
| 도메인 | 공개 HTTPS 도메인 (예: `pikiland.yourdomain.com`) |
| DNS | A 레코드 → 서버 IP |
| 포트 | 80, 443 외부 오픈 |

> **로컬 개발**: 도메인 없이 `localhost:8080`으로 실행할 수 있으나, GitHub App의 Webhook URL과 OAuth Callback URL은 반드시 공개 HTTPS 주소여야 합니다. 개발 시에는 ngrok이나 Cloudflare Tunnel을 활용하세요.

---

## 2. Step 1 — Nginx Reverse Proxy & SSL 설정

### 2-1. Nginx 설치

```bash
sudo apt update && sudo apt install -y nginx
```

### 2-2. Nginx 사이트 설정 파일 작성

`/etc/nginx/sites-available/pikiland.conf` 파일을 생성합니다.

```nginx
server {
    listen 80;
    server_name pikiland.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pikiland.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/pikiland.pem;
    ssl_certificate_key /etc/ssl/private/pikiland.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers   HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;

        proxy_read_timeout    300s;
        proxy_connect_timeout  75s;
        proxy_send_timeout    300s;
    }
}
```

> **Cloudflare를 사용하는 경우**: `X-Real-IP`를 `$http_cf_connecting_ip`로, `X-Forwarded-Proto`를 `$http_x_forwarded_proto`로 변경하세요.

### 2-3. Nginx 설정 적용

```bash
sudo ln -s /etc/nginx/sites-available/pikiland.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 3. Step 2 — GitHub App 등록

### 3-1. GitHub App 생성

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App으로 이동합니다.

**기본 정보 (General)**

| 항목 | 값 |
|------|-----|
| **GitHub App name** | `PikiLand-AutoFix` (유니크한 이름) |
| **Homepage URL** | `https://pikiland.yourdomain.com` |
| **Callback URL** | `https://pikiland.yourdomain.com/login/oauth2/code/github` |
| **Setup URL** | `https://pikiland.yourdomain.com/dashboard` |
| **Webhook URL** | `https://pikiland.yourdomain.com/api/webhook` |
| **Webhook Secret** | 안전한 랜덤 문자열 (예: `openssl rand -hex 32` 결과) |
| **Where can this GitHub App be installed?** | `Any account` 또는 `Only on this account` |

### 3-2. Repository 권한 설정

| 권한 | 수준 | 이유 |
|------|------|------|
| **Actions** | Read & Write | 워크플로 트리거 및 빌드 로그 다운로드 |
| **Checks** | Read & Write | CI 상태 확인 |
| **Contents** | Read & Write | `pikiland.yml` 삽입 및 코드 읽기 |
| **Issues** | Read & Write | 이슈 이벤트 수신 및 댓글 |
| **Pull requests** | Read & Write | 패치 PR 생성 |
| **Workflows** | Read & Write | `.github/workflows/` 파일 작성 |

### 3-3. 이벤트 구독

Subscribe to Events 섹션에서 다음 이벤트를 체크합니다.

- `Workflow run` — CI 실패 감지
- `Issues` — GitHub 이슈 감지

### 3-4. 자격 증명 수집

App 생성 완료 후 다음 5가지 값을 모두 기록해 둡니다.

| 값 | 위치 |
|----|------|
| **App ID** | App 설정 페이지 상단 (예: `1029384`) |
| **Client ID** | App 설정 페이지 `Client ID` 항목 |
| **Client Secret** | `Generate a new client secret` 클릭 후 복사 (한 번만 표시됨) |
| **Private Key** | `Generate a private key` 클릭 → `.pem` 파일 다운로드 |
| **Webhook Secret** | 3-1에서 직접 입력한 값 |

> ⚠️ Client Secret과 Private Key는 생성 직후에만 확인 가능합니다. 반드시 안전한 곳에 보관하세요.

---

## 4. Step 3 — 환경 변수 및 Docker Compose 설정

### 4-1. `.env` 파일 작성

```env
# 어드민 대시보드(/admin)에 접근 가능한 GitHub 사용자명 (쉼표 구분)
PIKILAND_ADMIN_USERS="your_github_username"

# GitHub OAuth (최초 로그인용 부트스트랩)
GITHUB_CLIENT_ID="Ov23zXXXXXXXXXXXXXXX"
GITHUB_CLIENT_SECRET="a1b2c3d4e5f6g7h8i9j0abcdef..."

# PostgreSQL
DATABASE_URL="jdbc:postgresql://postgres:5432/pikilanddb"
DATABASE_USER="postgres"
DATABASE_PASSWORD="pikiland_secure_password_123!"

# Docker 이미지 (GHCR)
PIKILAND_IMAGE="ghcr.io/your_github_username/pikiland:latest"

# 디버그 모드 (운영 환경에서 반드시 false)
DEBUG="false"
```

> **참고**: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET`은 `.env`로도 설정 가능하지만, 보안을 위해 어드민 대시보드(`/admin`)에서 DB에 저장하는 방식을 권장합니다.

### 4-2. 컨테이너 실행

```bash
# (Private 이미지인 경우) GHCR 로그인(PAT 사용)
echo "GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 이미지 Pull 및 실행
docker compose pull
docker compose up -d

# 로그 확인
docker compose logs -f pikiland-server
```

## 5. Step 4 — 어드민 대시보드에서 GitHub App 설정

`/admin` 페이지는 `PIKILAND_ADMIN_USERS`에 등록된 사용자만 접근 가능합니다.

1. `https://pikiland.yourdomain.com` 접속 → GitHub OAuth 로그인.
2. 로그인 후 헤더의 **⚙️ Admin Settings** 링크 클릭 또는 `/admin` 직접 접속.
3. **Central System Settings** 폼 입력 후 Save:

| 필드 | 설명 |
|------|------|
| **GitHub App ID** | Step 2에서 수집한 App ID |
| **GitHub App Private Key** | `.pem` 파일의 전체 내용 (`-----BEGIN RSA PRIVATE KEY-----` 포함) |
| **GitHub Webhook Secret** | Step 2에서 설정한 Webhook Secret |
| **GitHub OAuth Client ID** | Step 2에서 수집한 Client ID |
| **GitHub OAuth Client Secret** | Step 2에서 수집한 Client Secret |

---

## 6. Step 5 — 대상 저장소에 GitHub App 설치

### 6-1. App 설치

GitHub → Settings → Applications → Install App 또는 어드민 페이지의 **Install App** 링크에서 대상 저장소 선택 후 설치.

### 6-2. 대상 저장소의 GitHub Actions 권한 설정

> **⚠️ 필수 단계**: `pikiland.yml` 내 `permissions: contents: write`가 선언되어 있어도, 저장소 레벨 설정이 Read-only이면 Push가 403으로 실패합니다.

```
대상 저장소 → Settings → Actions → General → Workflow permissions
   ✅ Read and write permissions
   ✅ Allow GitHub Actions to create and approve pull requests
```

### 6-3. AI API Key Secrets 등록

```
대상 저장소 → Settings → Secrets and variables → Actions → New repository secret
```

| Secret 이름 | 값 | 설명 |
|-------------|-----|------|
| `PIKILAND_AI_API_KEY` | `sk-...` | OpenAI 또는 Anthropic API Key (공통) |
| `OPENAI_API_KEY` | `sk-...` | OpenAI 전용 (선택) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic/Claude 전용 (선택) |
| `PIKILAND_GITHUB_TOKEN` | `ghp_...` | Engine이 Private 저장소를 체크아웃할 때 사용 (선택) |

`PIKILAND_AI_API_KEY` 하나만 설정하면 Engine이 OpenAI/Anthropic 양쪽에 폴백으로 시도합니다.

### 6-4. PikiLand 대시보드에서 저장소 활성화

`/dashboard` 접속 → 저장소 카드에서 설정:

| 설정 항목 | 설명 |
|-----------|------|
| **Active** 토글 | ON으로 설정하면 모니터링 시작. 비어있는 Harness는 자동 추론됩니다 |
| **Harness Command** | 테스트 명령 (예: `./gradlew test`). 비워두면 저장소 파일 분석으로 자동 추론 |
| **AI Model** | 사용할 AI 모델명 (예: `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| **AI Base URL** | 커스텀 AI API Base URL |
| **Slack Webhook URL** | Slack Incoming Webhook URL |
| **Ralph Max Retries** | Ralph Loop 최대 반복 횟수 (기본값: 3) |

## 7. Step 6 — Harness Command 설정 (Ralph Loop)

Harness Command는 **Red (오류 재현) → Green (패치 통과)**을 반복하는 Ralph Loop의 검증 기준입니다.

### 권장 Harness Command 예시

| 프레임워크 | 명령 |
|------------|------|
| Gradle (Java/Kotlin) | `./gradlew test` |
| Maven | `mvn test` |
| Node.js (npm) | `npm test` |
| Python (pytest) | `pytest` |
| Go | `go test ./...` |
| Ruby (RSpec) | `bundle exec rspec` |

### Harness Status 상태 흐름

```
NONE  →  (Auto-Infer 실행)  →  PENDING_CONFIRMATION
                                      │
               ┌──────────────────────┴───────────────────┐
               │ 사용자가 승인 (Approve)                   │ 사용자가 직접 입력
               ▼                                           ▼
            ACTIVE  ←──────────────────────────────────  ACTIVE
```

- **NONE**: Harness 미설정. Active 전환 시 자동 추론이 시도됩니다.
- **PENDING_CONFIRMATION**: 추론된 명령이 있으나 승인 대기 중. 대시보드 카드에 확인 배너 표시.
- **ACTIVE**: Harness 설정 완료. Ralph Loop에 사용될 준비 상태.
- **FAILED**: 자동 추론 실패. 수동 입력이 필요합니다.

---

## 8. Step 7 — 동작 확인

### 8-1. Webhook 수신 확인

GitHub App 설정 페이지 → **Advanced** 탭에서 웹훅 전달 이력을 확인합니다.

### 8-3. 서버 로그 확인

```bash
docker compose logs -f pikiland-server
docker compose logs --tail=100 pikiland-server
```

---

## 9. 업그레이드

```bash
docker compose down
docker compose pull
docker compose up -d 
```

---

## 10. 트러블슈팅

### 403 Permission to ... denied to github-actions[bot]

**원인**: 대상 저장소 Actions Workflow Permissions이 Read-only.

**해결**: Step 6-2 참고 → `Read and write permissions` 선택 + PR 생성 허용 체크.

---

### OAuth 로그인 후 redirect_uri_mismatch

**원인**: GitHub App의 Callback URL이 실제 접속 도메인과 불일치.

**해결**: GitHub App 설정 → Callback URL을 `https://실제도메인/login/oauth2/code/github`로 정확히 입력.

---

### Webhook 서명 검증 실패 (403 on /api/webhook)

**원인**: 어드민에 저장된 Webhook Secret과 GitHub App 설정의 Secret이 불일치.

**해결**: `/admin` → Central System Settings → Webhook Secret 재입력.

---

### pikiland.yml이 대상 저장소에 생성되지 않음

**원인**: Private Key가 잘못 설정되었거나 App이 해당 저장소에 미설치.

**확인**: `/admin`에서 App ID와 Private Key 재저장. GitHub App 설치 목록에서 대상 저장소 포함 여부 확인.

---

## 11. 보안 관련 사항

- **어드민 접근 제한**: `/admin`은 `PIKILAND_ADMIN_USERS`에 등록된 사용자만 접근 가능. `DEBUG=true`는 이 검사를 우회하므로 **운영 환경에서 절대 사용 금지**.
- **Webhook Secret**: `openssl rand -hex 32`로 최소 32바이트 랜덤 값 사용.
- **Webhook CSRF 제외**: `/api/webhook`은 CSRF 검사 대상에서 제외됩니다. GitHub HMAC-SHA256 서명 검증이 이를 대체합니다.
- **AI API Key**: 대상 저장소의 GitHub Actions Secret으로만 저장. PikiLand 서버는 이 키를 보관하지 않습니다.
- **PII 제거**: Context Bundle을 AI에 전달하기 전 PII와 Secret을 제거합니다. PR 설명에 원본 로그를 포함하지 않습니다.

---

## 12. 관련 문서

- [Architecture & Data Pipeline](./ARCHITECTURE_AND_DATA_PIPELINE.md) — 전체 데이터 흐름 및 컴포넌트 설계
- [Product Design](./DESIGN.md) — 제품 철학 및 MVP 범위
- [AGENTS.md](../AGENTS.md) — 에이전트 작업 가이드라인
