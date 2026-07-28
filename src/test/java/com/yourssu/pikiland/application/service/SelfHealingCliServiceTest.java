package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.port.AiAgentPort;
import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.yourssu.pikiland.domain.port.NotifierPort;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import com.yourssu.pikiland.domain.service.LogTruncator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SelfHealingCliServiceTest {

    private WorkspacePort workspacePort;
    private AiAgentPort openAiAdapter;
    private AiAgentPort anthropicAdapter;
    private NotifierPort notifierPort;
    private GithubAuthPort githubAuthPort;
    private LogTruncator logTruncator;
    private HarnessInferenceService harnessInferenceService;
    private SelfHealingCliService selfHealingCliService;

    @BeforeEach
    void setUp() {
        workspacePort = Mockito.mock(WorkspacePort.class);
        openAiAdapter = Mockito.mock(AiAgentPort.class);
        anthropicAdapter = Mockito.mock(AiAgentPort.class);
        notifierPort = Mockito.mock(NotifierPort.class);
        githubAuthPort = Mockito.mock(GithubAuthPort.class);
        logTruncator = Mockito.mock(LogTruncator.class);
        harnessInferenceService = Mockito.mock(HarnessInferenceService.class);

        selfHealingCliService = new SelfHealingCliService(
                workspacePort, openAiAdapter, anthropicAdapter, notifierPort, githubAuthPort, logTruncator, harnessInferenceService
        );
    }

    @Test
    @DisplayName("PIKILAND_LOG_CONTENT와 PIKILAND_RUN_ID가 모두 없으면 IllegalArgumentException이 발생한다")
    void run_MissingLogContentAndRunId_ThrowsException() {
        // Given required environment mocks without log_content or run_id
        // (Testing exception handling in SelfHealingCliService)
        System.setProperty("PIKILAND_EVENT_TYPE", "workflow_run");
        System.setProperty("GITHUB_TOKEN", "test-token");
        System.setProperty("GITHUB_REPOSITORY", "owner/repo");
        System.clearProperty("PIKILAND_LOG_CONTENT");
        System.clearProperty("PIKILAND_RUN_ID");

        assertThrows(IllegalArgumentException.class, () -> selfHealingCliService.run());

        // Cleanup
        System.clearProperty("PIKILAND_EVENT_TYPE");
        System.clearProperty("GITHUB_TOKEN");
        System.clearProperty("GITHUB_REPOSITORY");
    }
}
