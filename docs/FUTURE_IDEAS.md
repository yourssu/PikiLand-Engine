# Future Ideas

> 이 문서는 확정된 범위나 로드맵이 아닙니다.
>
> MVP 이후 다시 검토할 아이디어를 잃지 않기 위한 메모입니다. [Product Design](./DESIGN.md)과 충돌하면 Product Design이 우선합니다.

## 0. Overview

MVP는 준비된 Harness와 Ralph Loop 위에서 관측 Context를 연결하고 검증된 최선의 패치 하나를 전달하는 데 집중합니다. 아래 아이디어는 실제 사용 지표와 실패 사례를 확인한 뒤에만 제품 범위로 승격합니다.

승격할 때 확인할 것:

- 어떤 실제 실패를 해결하는가?
- 현재 방식으로 해결할 수 없는가?
- 성공과 실패를 어떻게 측정하는가?
- 데이터·비용·보안·설정 부담은 무엇인가?

## 1. Harness Bootstrap

- 저장소의 실행·테스트·배포 구조를 분석해 Harness 초안을 만든다.
- 사람이 한 번 검증한 뒤에만 자동 패치에 사용한다.
- Ralph Loop가 없는 저장소에 최소 반복 구조를 제안한다.
- 팀의 기존 Harness를 교체하지 않고 공통 계약만 연결한다.

## 2. Context & Memory

- Notion, Linear, 기획 문서, API 명세를 Context로 연결한다.
- 과거 Incident와 실제 머지된 해결 PR을 프로젝트 기억으로 사용한다.
- 정상 세션과 실패 세션을 비교한다.
- 여러 저장소의 trace와 변경 후보를 연결한다.

## 3. Behavioral Incident

- 정상 행동을 바탕으로 기대 흐름 후보를 제안한다.
- Funnel 급락, 반복 클릭, 완료 이벤트 누락을 탐지한다.
- 실제 API 응답 이후 잘못된 프론트 상태를 재구성한다.
- 규칙 없는 행동을 버그로 판단할 때의 오탐 제어를 연구한다.

## 4. Verification Extensions

- 오류 당시 프론트 artifact를 자동 복원한다.
- 오류 당시와 최신 프론트 버전을 병렬 검증한다.
- DB, 결제, 메시지 큐, 외부 SaaS의 후속 상태까지 확인한다.
- 제한된 production canary 검증을 검토한다.
- 성능·비용·보안 회귀까지 범위를 확장한다.

## 5. UX & Integrations

- Slack에서 재실행, 보류, 추가 Context 제공을 지원한다.
- 충분한 안전 기준 이후 Slack 머지를 다시 검토한다.
- Linear·Notion 이슈와 Incident·PR 상태를 연결한다.
- 비개발자가 프리뷰에서 핵심 흐름을 확인하고 피드백을 남긴다.

## 6. Agent & Operations

- 실제 머지·거절 결과를 후보 순위에 반영한다.
- Provider별 성공률·반복 수·Harness 통과율을 비교한다.
- 구독 한도 안에서 작업 우선순위와 예약 실행을 검토한다.
- 공개 저장소 운영 비용과 남용 방지 정책을 만든다.
- 심각도 기반 Slack 알림 필터를 검토한다.

## 7. Parked or Rejected

아직 폐기된 아이디어는 없습니다. 폐기할 때는 이유와 다시 볼 조건을 함께 기록합니다.
