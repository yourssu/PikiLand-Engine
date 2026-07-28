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

    @Test
    @DisplayName("mergePatches는 이전 패치와 새 보완 패치를 파일 경로 단위로 누적/병합한다")
    void mergePatches_ConsolidatesMultiFilePatchesCorrectly() {
        com.yourssu.pikiland.domain.model.PatchInstruction patchA = 
                new com.yourssu.pikiland.domain.model.PatchInstruction("src/FileA.java", "oldA", "newA");
        com.yourssu.pikiland.domain.model.PatchInstruction patchB = 
                new com.yourssu.pikiland.domain.model.PatchInstruction("src/FileB.java", "oldB", "newB");
        com.yourssu.pikiland.domain.model.PatchInstruction patchAUpdated = 
                new com.yourssu.pikiland.domain.model.PatchInstruction("src/FileA.java", "oldA", "newA_v2");

        java.util.List<com.yourssu.pikiland.domain.model.PatchInstruction> base = java.util.List.of(patchA);
        java.util.List<com.yourssu.pikiland.domain.model.PatchInstruction> additions = java.util.List.of(patchB, patchAUpdated);

        java.util.List<com.yourssu.pikiland.domain.model.PatchInstruction> merged = selfHealingCliService.mergePatches(base, additions);

        org.junit.jupiter.api.Assertions.assertEquals(2, merged.size(), "Merged patch list should contain both FileA and FileB");

        com.yourssu.pikiland.domain.model.PatchInstruction mergedA = merged.stream()
                .filter(p -> p.getFilePath().equals("src/FileA.java"))
                .findFirst().orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals("newA_v2", mergedA.getNewCode(), "FileA should be updated to the latest addition code");

        com.yourssu.pikiland.domain.model.PatchInstruction mergedB = merged.stream()
                .filter(p -> p.getFilePath().equals("src/FileB.java"))
                .findFirst().orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals("newB", mergedB.getNewCode(), "FileB should be preserved in merged result");
    }
}

