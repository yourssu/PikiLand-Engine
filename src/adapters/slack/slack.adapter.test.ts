import { describe, expect, test } from "bun:test";
import { SlackAdapter } from "./slack.adapter";
import { AiAnalysisResult } from "../../domain/models";

describe("SlackAdapter Test", () => {
  const adapter = new SlackAdapter();

  test("should format Slack message with Korean headers and PR links", () => {
    const aiResult: AiAnalysisResult = {
      isConfident: true,
      summary: "NullPointerException이 발생했습니다.",
      impact: "결제 서비스 둔화",
      causeDescription: "NPE on line 42",
      prNeeded: true,
      prCandidates: [
        {
          patchSummary: "Null 가드 조건 추가",
          prTitle: "fix: add null check in PaymentService",
          prBody: "### 수정 설명\nNPE 발생 원인을 방지하기 위해 null 가드 조건을 추가했습니다.",
        },
      ],
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
    expect(message).toContain("NullPointerException이 발생했습니다.");
    expect(message).toContain("⚠️ 위험도 및 서비스 영향");
    expect(message).toContain("결제 서비스 둔화");
    expect(message).toContain("🤖 *[AI 자동 코드 패치 후보]*");
    expect(message).toContain("🛠️ *수정 내용*: Null 가드 조건 추가");
    expect(message).toContain("👉 *PR 링크*: <https://github.com/yourssu/PikiLand/pull/1|보기>");
  });
});
