package com.yourssu.pikiland.infrastructure.ai;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

class OpenAiAdapterTest {

    private OpenAiAdapter openAiAdapter;

    @BeforeEach
    void setUp() {
        openAiAdapter = new OpenAiAdapter("https://api.openai.com", "key", "gpt-4o", java.util.Optional.empty());
    }

    @Test
    @DisplayName("JSON 응답 문자열 및 소스코드 내부 // 문자열이 훼손되지 않고 주석 처리와 파싱이 성공한다")
    void parseAnalysisResult_PreservesSlashInCodeStringsAndAllowsComments() {
        String jsonWithCommentsAndSlashInCode = """
                {
                  // This is a valid JSON comment allowed by Jackson
                  "is_confident": true,
                  "summary": "에러 요약",
                  "impact": "영향 없음",
                  "cause_description": "원인 설명",
                  "pr_needed": true,
                  "pr_candidates": [
                    {
                      "patch_summary": "수정 요약",
                      "pr_title": "Fix null pointer",
                      "pr_body": "PR 본문 설명",
                      "patch_instructions": [
                        {
                          "file_path": "src/App.java",
                          "old_code": "String url = \\"//example.com/api\\"; // old comment",
                          "new_code": "String url = \\"https://example.com/api\\";"
                        }
                      ]
                    }
                  ]
                }
                """;

        AiAnalysisResult result = ReflectionTestUtils.invokeMethod(openAiAdapter, "parseAnalysisResult", jsonWithCommentsAndSlashInCode);

        assertNotNull(result);
        assertTrue(result.isConfident());
        assertEquals("에러 요약", result.getSummary());
        assertTrue(result.isPrNeeded());
        assertEquals(1, result.getPrCandidates().size());

        String oldCode = result.getPrCandidates().get(0).getPatchInstructions().get(0).getOldCode();
        assertTrue(oldCode.contains("//example.com/api"), "The // string inside JSON string literal should not be corrupted by regex");
    }
}
