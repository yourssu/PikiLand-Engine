package com.yourssu.pikiland.infrastructure.slack;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PrCandidate;
import com.yourssu.pikiland.domain.port.NotifierPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class SlackNotifierAdapter implements NotifierPort {

    private final RestTemplate restTemplate;

    public SlackNotifierAdapter() {
        org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);
    }

    @Override
    public void sendNotification(String webhookUrl, String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, List<String> prUrls) {
        boolean isInvalidWebhook = webhookUrl == null || webhookUrl.isBlank() || 
                                   webhookUrl.contains("your/webhook/url") || 
                                   !webhookUrl.startsWith("https://");

        String slackMessage = buildSlackMessage(rawLog, aiResult, eventType, repo, runId, prUrls);

        if (isInvalidWebhook) {
            System.out.println("Warning: SLACK_WEBHOOK_URL is not set or is a placeholder. Printing payload to stdout.");
            System.out.println(slackMessage);
            return;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, String> payload = new HashMap<>();
            payload.put("text", slackMessage);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            restTemplate.postForEntity(webhookUrl, entity, String.class);
            System.out.println("Slack notification sent successfully.");
        } catch (Exception e) {
            System.err.println("Failed to send Slack notification: " + e.getMessage());
        }
    }

    @Override
    public void sendErrorNotification(String webhookUrl, String repo, String errorMessage) {
        boolean isInvalidWebhook = webhookUrl == null || webhookUrl.isBlank() ||
                                   webhookUrl.contains("your/webhook/url") ||
                                   !webhookUrl.startsWith("https://");

        String message = "❌ *[" + repo + "] PikiLand 자가 치유 파이프라인 실패*\n\n" +
                "*오류 내용:*\n```" + errorMessage + "```\n\n" +
                "담당자가 직접 확인 및 조치가 필요합니다.";

        if (isInvalidWebhook) {
            System.err.println("[PikiLand Error] Self-healing FAILED for " + repo + ": " + errorMessage);
            return;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, String> payload = new HashMap<>();
            payload.put("text", message);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            restTemplate.postForEntity(webhookUrl, entity, String.class);
            System.out.println("Slack error notification sent for: " + repo);
        } catch (Exception e) {
            System.err.println("Failed to send Slack error notification: " + e.getMessage());
        }
    }

    private String buildSlackMessage(String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, List<String> prUrls) {
        String title = "🚨 *[" + repo + "] AI 시스템 장애 감지 및 자가 치유 알림*";
        String context;
        if ("issues".equals(eventType)) {
            context = "• *발생 이벤트*: 새로운 이슈/건의 접수";
        } else {
            context = "• *발생 이벤트*: 빌드 및 배포 실패\n• *실행 정보(Run ID)*: <https://github.com/" + repo + "/actions/runs/" + runId + "|" + runId + ">";
        }

        String summary = aiResult.getSummary() != null ? aiResult.getSummary() : "핵심 요약 정보가 존재하지 않습니다.";
        String impact = aiResult.getImpact() != null ? aiResult.getImpact() : "영향 범위 정보가 존재하지 않습니다.";
        
        StringBuilder prStatusBuilder = new StringBuilder();
        if (prUrls != null && !prUrls.isEmpty()) {
            prStatusBuilder.append("🤖 *[AI 자동 코드 패치 후보]*\n문제를 감지하여 자동으로 코드를 수정하고 Pull Request(PR) 후보들을 생성했습니다. 개발팀의 검토가 필요합니다:\n\n");
            for (int i = 0; i < prUrls.size(); i++) {
                String prUrl = prUrls.get(i);
                PrCandidate candidate = (aiResult.getPrCandidates() != null && i < aiResult.getPrCandidates().size()) 
                        ? aiResult.getPrCandidates().get(i) : null;
                String patchSummary = (candidate != null && candidate.getPatchSummary() != null) 
                        ? candidate.getPatchSummary() : "코드 수정을 완료했습니다.";
                prStatusBuilder.append(String.format("*후보 %d*\n", i + 1));
                prStatusBuilder.append(String.format("🛠️ *수정 내용*: %s\n", patchSummary));
                prStatusBuilder.append(String.format("👉 *PR 링크*: <%s|보기>\n\n", prUrl));
            }
        } else {
            prStatusBuilder.append("ℹ️ *[AI 자동 코드 패치]* 원인이 불명확하거나 코드로 해결할 수 없어 자동 PR을 생성하지 않았습니다.");
        }
        String prStatus = prStatusBuilder.toString().trim();

        return title + "\n\n" +
               context + "\n\n" +
               "*📌 핵심 요약*\n" + summary + "\n\n" +
               "*⚠️ 위험도 및 서비스 영향*\n" + impact + "\n\n" +
               prStatus;
    }
}
