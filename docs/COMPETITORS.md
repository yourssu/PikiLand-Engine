# Competitive Research

> 마지막 확인: 2026-07-15
>
> 경쟁 제품의 기능과 가격은 바뀔 수 있습니다. 이 문서는 비교 기준만 유지하며 제품 결정은 [Product Design](./DESIGN.md)을 우선합니다.

## 0. Overview

Sentry와 PostHog도 관측 데이터로 원인을 분석하고 패치 또는 PR을 만드는 영역에 들어와 있습니다. CodeRabbit은 GitHub App 설치와 코드 문맥 활용 경험의 참고점입니다.

PikiLand는 **PR 생성 자체가 아니라, 관측 공급자 독립성·기존 코딩 에이전트 활용·모델 밖의 Red → Green 검증·최선의 후보 하나만 공개**하는 데 집중합니다.

| 서비스 | 강한 영역 | PikiLand가 다르게 집중할 부분 |
| --- | --- | --- |
| Sentry Seer | Sentry 오류·trace·log 기반 원인 분석과 수정 | 여러 관측 소스와 실제 재현·회귀 게이트 |
| PostHog AI 제품 | 행동·Replay·Error·Log 문맥 | 공급자 독립성과 외부 Harness 검증 |
| CodeRabbit | GitHub App 설치와 PR 코드 리뷰 | 운영 Incident 수집과 실제 실패 재현 |

## 1. Sentry Seer

Sentry Seer는 Issue, stack trace, trace, log, profile과 코드베이스를 이용해 원인을 분석하고 코드 변경이나 PR까지 만들 수 있습니다.

PikiLand에 주는 의미는 명확합니다. `런타임 오류 → AI 분석 → PR`만으로는 차별화할 수 없습니다. PikiLand는 Sentry 밖의 행동·서버 데이터도 연결하고, 재현되지 않은 패치를 공개하지 않는 검증 계약으로 비교돼야 합니다.

- [Sentry Seer](https://docs.sentry.io/product/ai-in-sentry/seer)
- [Seer Issue Fix API](https://docs.sentry.io/api/seer/start-seer-issue-fix/)

## 2. PostHog

PostHog는 Error Tracking, Session Replay, Logs와 사용자 행동을 한 제품군에서 제공합니다. PikiLand는 이 데이터를 좋은 입력으로 활용할 수 있지만 PostHog에 종속되지는 않습니다.

PostHog의 AI 제품 명칭과 과금 방식은 변할 수 있으므로 구현 전에 공식 가격표와 API를 다시 확인합니다.

- [PostHog](https://posthog.com/)
- [PostHog Pricing](https://posthog.com/pricing)

## 3. CodeRabbit

참고할 부분:

- GitHub App 설치 중심의 낮은 도입 마찰
- 저장소 지침과 코드 문맥 활용
- 개발자 결과를 PR에 자연스럽게 전달하는 UX

경계는 다릅니다. CodeRabbit의 중심은 PR 리뷰이고, PikiLand의 중심은 운영 Incident를 수집하고 실제 실패를 재현해 패치를 검증하는 것입니다.

- [CodeRabbit Documentation](https://docs.coderabbit.ai/)

## 4. PikiLand Wedge

> 팀이 이미 사용하는 관측 도구와 코딩 에이전트를 연결해, 별도의 오류 수정 AI 제품에 종속되지 않고, 실제 실패의 Red → Green과 회귀 검증을 통과한 최선의 패치 하나만 전달한다.

비교할 때 반드시 확인할 기준:

1. 특정 관측 제품에 종속되는가?
2. 서버 오류와 예외 없는 프론트 행동 실패를 모두 다루는가?
3. 패치 전 실제 재현을 요구하는가?
4. 오류 부재가 아니라 기대 비즈니스 결과를 확인하는가?
5. 회귀와 오류 은폐를 모델 밖에서 검사하는가?
6. 실패 후보를 PR로 노출하는가?

## 5. Watch List

- Sentry·PostHog의 검증 범위와 가격 변화
- CodeRabbit의 런타임 Incident 영역 확장
- Claude와 Codex의 구독 기반 GitHub 자동화 정책
