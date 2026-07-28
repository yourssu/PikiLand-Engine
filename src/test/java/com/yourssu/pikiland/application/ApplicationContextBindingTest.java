package com.yourssu.pikiland.application;

import com.yourssu.pikiland.infrastructure.ai.OpenAiAdapter;
import com.yourssu.pikiland.infrastructure.ai.AnthropicAdapter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ApplicationContextBindingTest {

    @Autowired
    private OpenAiAdapter openAiAdapter;

    @Autowired
    private AnthropicAdapter anthropicAdapter;

    @Test
    @DisplayName("환경변수/프로퍼티 주입 없이도 Spring ApplicationContext가 정상적으로 초기화되며 OpenAiAdapter 빈이 성공적으로 생성된다")
    void contextLoads_WithoutUnsatisfiedDependencyException() {
        assertNotNull(openAiAdapter, "openAiAdapter bean should be successfully created without UnsatisfiedDependencyException");
        assertNotNull(anthropicAdapter, "anthropicAdapter bean should be successfully created");

        String openAiBaseUrl = (String) ReflectionTestUtils.getField(openAiAdapter, "baseUrl");
        assertNotNull(openAiBaseUrl);
        assertFalse(openAiBaseUrl.isBlank());
        assertEquals("https://api.openai.com/v1", openAiBaseUrl);
    }
}
