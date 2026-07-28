package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import java.nio.file.Path;
import java.util.List;

public interface AiAgentPort {
    AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel);

    AiAnalysisResult refinePatch(
            String originalLogContent,
            String eventType,
            Path workspace,
            WorkspacePort workspacePort,
            String customModel,
            List<PatchInstruction> failedPatches,
            String harnessFailureLog
    );
}
