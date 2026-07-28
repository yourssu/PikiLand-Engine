package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import java.util.List;

public interface NotifierPort {
    void sendNotification(String webhookUrl, String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, List<String> prUrls);

    /**
     * Sends a plain failure alert when the self-healing pipeline itself crashes
     * (e.g. AI loop exceeded, clone failure, unhandled exception).
     */
    void sendErrorNotification(String webhookUrl, String repo, String errorMessage);
}
