package com.yourssu.pikiland.infrastructure.ai;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

class AnthropicAdapterTest {

    private AnthropicAdapter anthropicAdapter;

    @BeforeEach
    void setUp() {
        anthropicAdapter = new AnthropicAdapter("https://api.anthropic.com", "key", "claude-3-5-sonnet-20240620");
    }

    @Test
    @DisplayName("Anthropic어댑터 - submit_analysis 툴 호출 대신 마크다운 JSON 텍스트로 응답되어도 parseTextFallback이 성공한다")
    void parseTextFallback_SuccessfullyParsesMarkdownJson() throws Exception {
        String markdownText = """
                여기 분석 결과입니다:
                ```json
                {
                  "is_confident": true,
                  "summary": "안트로픽 텍스트 폴백 요약",
                  "impact": "심각도 낮음",
                  "cause_description": "원인 설명",
                  "pr_needed": true,
                  "pr_candidates": [
                    {
                      "patch_summary": "수정 요약",
                      "pr_title": "Fix anthropic fallback",
                      "pr_body": "설명",
                      "patch_instructions": [
                        {
                          "file_path": "src/Main.java",
                          "old_code": "int a = 1;",
                          "new_code": "int a = 2;"
                        }
                      ]
                    }
                  ]
                }
                ```
                """;

        AiAnalysisResult result = ReflectionTestUtils.invokeMethod(anthropicAdapter, "parseTextFallback", markdownText);

        assertNotNull(result);
        assertTrue(result.isConfident());
        assertEquals("안트로픽 텍스트 폴백 요약", result.getSummary());
        assertTrue(result.isPrNeeded());
        assertEquals(1, result.getPrCandidates().size());
        assertEquals("src/Main.java", result.getPrCandidates().get(0).getPatchInstructions().get(0).getFilePath());
    }
}
