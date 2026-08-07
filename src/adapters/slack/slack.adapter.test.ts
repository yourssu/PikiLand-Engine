import { describe, expect, test } from "bun:test";
import { SlackAdapter } from "./slack.adapter";
import { AiAnalysisResult } from "../../domain/models";

describe("SlackAdapter Test", () => {
  const adapter = new SlackAdapter();

  test("should format Slack message with Korean headers and PR links", () => {
    const aiResult: AiAnalysisResult = {
      isConfident: true,
      summary: "결제 처리 도중 오류가 발생했습니다.",
      impact: "결제 화면에서 구매 버튼이 클릭되지 않음",
      causeDescription: "NPE on line 42",
      prNeeded: true,
      prTitle: "fix: add null check in PaymentService",
      prBody: "### 수정 설명\nNPE 발생 원인을 방지하기 위해 null 가드 조건을 추가했습니다.",
      prNotNeededReason: null,
      issueNeeded: null,
      issueTitle: null,
      issueBody: null,
    };

    const message = adapter.buildSlackMessage(
      "raw log text",
      aiResult,
      "workflow_run",
      "yourssu/PikiLand",
      "12345",
      ["https://github.com/yourssu/PikiLand/pull/1"]
    );

    expect(message).toContain("AI 시스템 장애 감지 및 자가 치유 알림");
    expect(message).toContain("📌 핵심 요약");
    expect(message).toContain("결제 처리 도중 오류가 발생했습니다.");
    expect(message).toContain("⚠️ 위험도 및 서비스 영향");
    expect(message).toContain("결제 화면에서 구매 버튼이 클릭되지 않음");
    expect(message).toContain("🤖 *[AI 자동 코드 패치 생성 완료]*");
    expect(message).toContain("🛠️ *수정 항목*: fix: add null check in PaymentService");
    expect(message).toContain("👉 *PR 바로가기*: <https://github.com/yourssu/PikiLand/pull/1|GitHub PR 보기>");
  });
});
