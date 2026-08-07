import { describe, expect, it } from "bun:test";
import { AiAdapter } from "./ai.adapter";
import { AiAnalysisResultSchema } from "../../domain/models";

describe("AiAdapter Test", () => {
  it("should instantiate AiAdapter successfully", () => {
    const adapter = new AiAdapter();
    expect(adapter).toBeDefined();
  });

  it("should validate AiAnalysisResultSchema with nullable fields for OpenAI strict mode compliance", () => {
    const validData = {
      isConfident: true,
      summary: "Test summary",
      impact: "Test impact",
      causeDescription: "Test cause",
      prNeeded: true,
      prNotNeededReason: null,
      issueNeeded: null,
      issueTitle: null,
      issueBody: null,
      prCandidates: [],
    };

    const parsed = AiAnalysisResultSchema.parse(validData);
    expect(parsed.prNeeded).toBeTrue();
    expect(parsed.issueNeeded).toBeNull();
    expect(parsed.prNotNeededReason).toBeNull();

    // Verify JSON serialization doesn't throw or corrupt
    const jsonString = JSON.stringify(parsed);
    expect(jsonString).toContain('"prNeeded":true');
    expect(jsonString).toContain('"prNotNeededReason":null');
  });

  it("should validate AiAnalysisResultSchema when prNeeded is false with issueNeeded", () => {
    const validData = {
      isConfident: true,
      summary: "Test summary",
      impact: "Test impact",
      causeDescription: "Test cause",
      prNeeded: false,
      prNotNeededReason: "로그가 부족하여 PR 생성 불가",
      issueNeeded: true,
      issueTitle: "Test Issue Title",
      issueBody: "Test Issue Body",
      prCandidates: [],
    };

    const parsed = AiAnalysisResultSchema.parse(validData);
    expect(parsed.prNeeded).toBeFalse();
    expect(parsed.issueNeeded).toBeTrue();
    expect(parsed.prNotNeededReason).toBe("로그가 부족하여 PR 생성 불가");
    expect(parsed.issueTitle).toBe("Test Issue Title");
  });
});
