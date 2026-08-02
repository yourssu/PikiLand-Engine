# Architecture & Data Pipeline

> 상태: 목표 구조 초안 · 마지막 수정: 2026-07-15
>
> 이 문서는 검증된 PR을 만드는 목표 구조를 설명합니다. 제품 범위와 우선순위는 [Product Design](./DESIGN.md)을 우선합니다.

## 0. Overview

PikiLand는 관측 이벤트를 하나의 Incident로 묶고, 코드·로그·행동·릴리스를 Context Bundle로 연결합니다. 선택한 AI Provider가 패치 후보를 만들지만, 완료 여부는 모델의 자신감이 아니라 Harness의 재현·기대 결과·회귀 검증으로 결정합니다.

### 전체 구조

```text
GitHub / PostHog / Sentry / Logs
                 │
                 ▼
       Webhook API & Adapters
                 │
                 ▼
       Incident Store + Queue
                 │
                 ▼
              Worker
          ┌──────┴──────┐
          ▼             ▼
   Context Builder   AI Provider
                         │
                         ▼
              Ralph Loop + Harness
                         │
                         ▼
             Candidate Ranker
                         │
                    PR + Slack
```

### 데이터 흐름

```text
원본 이벤트
  → 공통 Incident로 정규화
  → 중복 병합
  → 코드·로그·세션·릴리스 연결
  → PII와 Secret 제거
  → Context Bundle
  → 패치 후보와 검증 결과
  → 정제된 PR 근거와 Slack 요약
  → 원본 Context 만료
```

### MVP 전제

- 저장소에 신뢰할 수 있는 재현·E2E Harness가 있다.
- Ralph Loop 또는 동등한 반복 실행 계약이 있다.
- Harness 결과를 기계가 판정할 수 있다.
- 준비되지 않은 저장소에는 자동 패치 PR을 만들지 않는다.

## 1. Contracts

### Repository Readiness

```text
저장소 접근
  → Harness 명령 확인
  → Ralph Loop 실행 확인
  → Secret·환경 연결 확인
  → 구조화 결과 확인
  → Ready 또는 Setup Required
```

`Setup Required` 상태에서는 빠진 항목만 안내합니다.

### Harness Contract

Harness는 기술스택과 관계없이 다음을 제공해야 합니다.

- Incident Context 입력
- 패치 전 오류 재현
- 패치 후 동일 시나리오 실행
- 관련 정상 흐름의 회귀 검사
- 화면·응답·DB·외부 시스템의 기대 결과 assertion
- 로그·스크린샷 등 증거 artifact
- 성공·실패·검증 불가의 구조화 출력

정확한 명령과 결과 스키마는 아직 미결정입니다.

### Ralph Loop Contract

- Harness 실패 결과를 다음 AI 반복에 전달한다.
- 후보·진행 상태·남은 작업을 모델 밖에 저장한다.
- 성공, 재현 불가, 검증 실패, 무진전, 사용량 소진을 구분한다.
- 외부 Harness 결과가 완료를 판정한다.

## 2. Components

| 컴포넌트 | 책임 |
| --- | --- |
| GitHub App | 설치·권한·웹훅·브랜치·PR 관리 |
| Incident Adapter | 공급자 이벤트를 공통 Incident로 변환 |
| Context Builder | 코드·로그·행동·릴리스를 연결하고 민감정보 제거 |
| Incident Store | 중복 키와 처리 상태 보관 |
| Work Queue | 웹훅과 장시간 작업 분리, 재시도·복구 |
| Worker | Provider와 Ralph Loop 실행 |
| AI Provider | Claude·Codex의 서로 다른 인증과 실행을 Adapter로 격리 |
| Harness | 재현, 기대 결과, 회귀, 오류 은폐 판정 |
| Candidate Ranker | 성공 후보의 근거·변경 범위·복잡도 비교 |
| PR Publisher | 최선의 후보 하나와 검증 증거 공개 |
| Slack Notifier | 쉬운 결과 요약과 링크 전달 |

### GitHub App과 GitHub Actions의 경계

- GitHub App은 외부 이벤트와 전체 상태를 오케스트레이션합니다.
- GitHub Actions는 저장소 내부의 빌드와 Harness 실행에 사용합니다.
- 웹훅 서버는 서명 검증과 작업 등록 후 빠르게 응답합니다.
- AI·Harness·Ralph Loop는 복구 가능한 Worker에서 실행합니다.

GitHub도 웹훅 요청에는 빠르게 응답하고 긴 작업은 Queue로 넘길 것을 권장합니다. [GitHub Webhook Best Practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

## 3. Data Pipeline

### 입력

| 영역 | 예시 | 핵심 데이터 |
| --- | --- | --- |
| CI | GitHub Actions | 실패 로그, workflow, commit |
| 오류 | PostHog Error Tracking, Sentry | 예외, stack trace, fingerprint, release |
| 행동 | PostHog events·Session Replay | 클릭, 이동, 완료 이벤트, session |
| 서버 | 기존 로그·trace | request, trace, 서버 상태 |
| 버전 | GitHub, 배포 시스템 | backend commit, frontend release |

Sentry와 PostHog를 동시에 요구하지 않습니다. 사용 가능한 공급자의 조합으로 Context를 만들되, 연결이 불확실하면 사실로 단정하지 않습니다.

### 처리 단계

1. **Ingest:** 웹훅 서명과 출처를 검증한다.
2. **Normalize:** 공급자별 이벤트를 공통 Incident로 변환한다.
3. **Deduplicate:** 같은 오류와 release의 반복 이벤트를 합친다.
4. **Correlate:** 식별자와 시간 범위로 코드·로그·행동·릴리스를 연결한다.
5. **Redact:** PII, 토큰, 비밀번호를 제거한다.
6. **Bundle:** AI와 Harness가 읽을 Context Bundle을 만든다.
7. **Verify:** 후보와 검증 결과를 Incident에 연결한다.
8. **Publish:** 공개 가능한 근거만 PR과 Slack에 보낸다.
9. **Expire:** 원본 Context와 일회성 권한을 삭제한다.

연결 우선순위는 `trace_id → request_id → session_id → user_id+시간 → endpoint+release+시간`입니다.

### 연결 불확실성 표시

관측 데이터 연결은 다음 상태로 기록하고 사용자 결과에도 표시합니다.

| 상태 | 의미 | 처리 |
| --- | --- | --- |
| Exact | trace·request처럼 직접 식별자로 연결됨 | 사실로 사용 |
| Probable | 시간·release·endpoint가 강하게 일치함 | 추론임을 표시하고 재현으로 확인 |
| Ambiguous | 가능한 세션·로그가 여러 개임 | 후보를 제한해 시도하되 단정하지 않음 |
| Missing | 연결할 데이터가 부족함 | 필요한 Context를 알리고 재현 가능 여부만 확인 |

PR과 Slack 결과에는 연결 상태, 사용한 근거, 누락된 데이터와 재현 결과를 함께 표시합니다. `Probable`이나 `Ambiguous`에서 시작했더라도 Harness가 원래 오류를 독립적으로 재현하면 검증을 계속할 수 있습니다. 재현하지 못하면 `Unreproducible`로 종료하고 최종 PR을 공개하지 않습니다.

## 4. Patch & Verification Loop

최종 PR은 다음을 모두 만족해야 합니다.

1. 패치 전 환경에서 원래 문제가 재현된다.
2. 패치 후 같은 조건에서 문제가 사라진다.
3. 기대한 비즈니스 결과가 실제로 발생한다.
4. 영향 범위의 정상 흐름이 깨지지 않는다.
5. 예외를 무시하거나 실패를 성공처럼 보이게 하지 않는다.

```text
Baseline 재현
  → 원인·패치 후보 N개
  → 후보별 격리 실행
  → Harness 실패를 Ralph 반복에 전달
  → 실패·재현 불가 후보 폐기
  → 성공 후보 비교
  → 최선의 하나만 공개
```

오류 당시 프론트 버전을 필수 검증하고, 최신 배포 버전이 다르면 추가로 검증합니다. 성공 후보가 여러 개면 증거 강도, 회귀 범위, 변경 크기, 복잡도, 되돌리기 용이성 순으로 비교합니다.

| 종료 상태 | PR | 결과 |
| --- | :---: | --- |
| Verified | O | 최선의 패치와 검증 근거 |
| Unreproducible | X | 부족한 재현 정보 |
| Verification failed | X | 후보별 실패 이유 |
| Usage exhausted | X | 재개 조건 |
| Harness unavailable | X | 저장소 준비 항목 |

## 5. Recommended New Structure

이 구조는 **현재 Java 코드를 반드시 마이그레이션한다는 결정이 아니라, 처음부터 신규 구현할 때의 권장안**입니다.

| 영역 | 권장 선택 | 이유 |
| --- | --- | --- |
| 언어 | TypeScript + Node.js Active LTS | GitHub 이벤트·JSON 스키마·Provider·Worker를 한 타입 시스템으로 유지 |
| GitHub App | Probot + Octokit | 인증, 웹훅 검증, 이벤트 타입, 설치 단위 API 호출을 기본 제공 |
| 상태 저장 | PostgreSQL | Incident와 검증 상태를 일관되게 저장 |
| 작업 큐 | pg-boss | PostgreSQL 하나로 재시도·동시성·실패 작업을 관리해 초기 인프라 축소 |
| 실행 | 격리된 Worker·ephemeral container | 사용자 코드를 Control Plane에서 직접 실행하지 않음 |
| 검증 | 저장소 Harness + Ralph Loop | 프로젝트의 기대 결과는 저장소가 정의하고 PikiLand는 반복을 관리 |

### Probot이 하는 일

Probot은 Node.js용 GitHub App 프레임워크입니다. 웹훅 이벤트를 `app.on(...)`으로 받고, 인증된 `context.octokit`으로 GitHub API를 호출하며, TypeScript 웹훅 타입과 서명 검증·로깅을 제공합니다. [Probot](https://probot.github.io/docs/), [Receiving Webhooks](https://probot.github.io/docs/webhooks/)

### 현재 Java·Spring보다 신규 구조가 적합한 근거

1. **제품 중심과 프레임워크 중심이 일치합니다.** PikiLand의 주된 일은 일반 웹 CRUD보다 GitHub 웹훅·권한·브랜치·PR 오케스트레이션입니다. Probot은 이 기반을 전용 기능으로 제공합니다.
2. **직접 유지할 GitHub 배관이 줄어듭니다.** 현재 구현은 웹훅 서명, 이벤트 파싱, App JWT·Installation Token을 직접 관리합니다. Probot과 Octokit을 사용하면 제품 고유 로직인 Context·검증에 더 집중할 수 있습니다.
3. **비동기 작업 경계가 명확해집니다.** Probot은 빠르게 이벤트를 받고, pg-boss Worker가 수분 이상 걸리는 AI·E2E 작업을 재시도·복구합니다. 현재 단순 비동기 스레드보다 프로세스 재시작과 실패 복구를 제품 상태로 다루기 쉽습니다.
4. **한 언어로 연결할 수 있습니다.** 웹훅 payload, Context Bundle, Provider 결과, Queue job을 TypeScript 타입으로 공유해 Adapter 사이의 변환 비용을 줄입니다.
5. **MVP 인프라가 작습니다.** PostgreSQL을 제품 DB와 Queue로 함께 사용하므로 초기에는 Redis나 Temporal을 추가하지 않아도 됩니다. [pg-boss](https://github.com/timgit/pg-boss)

### Spring을 유지하는 편이 나은 조건

- 현재 구현을 점진적으로 발전시키고 재작성 비용을 피하려는 경우
- 팀의 Java·Spring 운영 경험이 TypeScript보다 강한 경우
- 복잡한 트랜잭션·JPA 중심 기능이 빠르게 커지는 경우
- GitHub 전용 기능의 직접 구현 비용을 감수할 수 있는 경우

따라서 결론은 “TypeScript가 Java보다 우월하다”가 아닙니다. **신규 구현에서는 GitHub App 전용 도구와 비동기 AI 생태계에 가까워 개발 범위가 줄어든다**는 판단입니다. 현재 프로토타입을 유지한다면 Spring 위에 durable Queue, Worker, Provider 경계를 추가하는 선택도 타당합니다.

## 6. Security & Open Decisions

### 실행 원칙

- 원본 로그·Replay·사용자 식별자·Secret을 공개 PR에 넣지 않는다.
- 사용자 코드는 격리 환경에서 실행한다.
- 같은 Incident와 release는 멱등하게 처리한다.
- 저장소별 동시 작업 수를 제한한다.
- 구독 한도에 도달하면 자동 결제 없이 중단한다.

### 구현 전에 확정할 계약

- 여러 언어의 실제 저장소로 검증한 Harness 명령과 결과 스키마
- 후보당 반복 수, 연속 무진전 횟수, 시간·사용량 예산
- 오류 당시 프론트 artifact를 찾고 실행하는 배포 시스템 Adapter
- 후보 격리 방식과 실제 호스팅 환경

### 외부 기능 검증이 필요한 항목

- Claude Provider의 OAuth·Action 경로와 토큰 보관·갱신 방식
- Codex Provider의 구독 기반 무인 실행·완료 감지 지원 범위

성공 후보의 기본 비교 순서는 이미 결정됐습니다. 증거 강도, 회귀 결과, 변경 크기, 복잡도, 되돌리기 용이성 순으로 비교하고, 동점 처리만 구현 단계에서 확정합니다.
