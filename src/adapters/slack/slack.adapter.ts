import { AiAnalysisResult } from "../../domain/models";

export class SlackAdapter {
  public async sendNotification(
    slackWebhookUrl: string,
    logContent: string,
    aiResult: AiAnalysisResult,
    eventType: string,
    repoName: string,
    runId: string,
    prUrls: string[],
    issueUrl?: string | null
  ): Promise<void> {
    const isInvalidWebhook =
      !slackWebhookUrl ||
      slackWebhookUrl.trim().length === 0 ||
      slackWebhookUrl.includes("your/webhook/url") ||
      !slackWebhookUrl.startsWith("https://");

    const slackMessage = this.buildSlackMessage(logContent, aiResult, eventType, repoName, runId, prUrls, issueUrl);

    if (isInvalidWebhook) {
      console.log("Warning: SLACK_WEBHOOK_URL is not set or is a placeholder. Printing payload to stdout.");
      console.log(slackMessage);
      return;
    }

    try {
      const resp = await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackMessage }),
      });
      if (!resp.ok) {
        console.error(`[Slack] Failed to send webhook notification. HTTP status: ${resp.status}`);
      } else {
        console.log("Slack notification sent successfully.");
      }
    } catch (error) {
      console.error("Failed to send Slack notification:", error);
    }
  }

  public async sendErrorNotification(
    slackWebhookUrl: string,
    repoName: string,
    errorMessage: string
  ): Promise<void> {
    const isInvalidWebhook =
      !slackWebhookUrl ||
      slackWebhookUrl.trim().length === 0 ||
      slackWebhookUrl.includes("your/webhook/url") ||
      !slackWebhookUrl.startsWith("https://");

    const message =
      `❌ *[${repoName}] PikiLand 자가 치유 파이프라인 실패*\n\n` +
      `*오류 내용:*\n\`\`\`${errorMessage}\`\`\`\n\n` +
      `담당자가 직접 확인 및 조치가 필요합니다.`;

    if (isInvalidWebhook) {
      console.error(`[PikiLand Error] Self-healing FAILED for ${repoName}: ${errorMessage}`);
      return;
    }

    try {
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
      console.log(`Slack error notification sent for: ${repoName}`);
    } catch (error) {
      console.error("Failed to send Slack error notification:", error);
    }
  }

  public buildSlackMessage(
    rawLog: string,
    aiResult: AiAnalysisResult,
    eventType: string,
    repoName: string,
    runId: string,
    prUrls: string[],
    issueUrl?: string | null
  ): string {
    const title = `🚨 *[${repoName}] AI 시스템 장애 감지 및 자가 치유 알림*`;
    const context =
      eventType === "issues"
        ? "• *발생 이벤트*: 새로운 이슈/건의 접수"
        : `• *발생 이벤트*: ${eventType}\n• *실행 정보(Run ID/Hash)*: <https://github.com/${repoName}/actions/runs/${runId}|${runId}>`;

    const summary = aiResult.summary || "핵심 요약 정보가 존재하지 않습니다.";
    const impact = aiResult.impact || "영향 범위 정보가 존재하지 않습니다.";
    const cause = aiResult.causeDescription || "기술적 원인 분석 정보가 없습니다.";

    let logSnippet = "";
    if (rawLog && rawLog.trim().length > 0) {
      const trimmed = rawLog.trim();
      const snippet = trimmed.length > 500 ? trimmed.substring(0, 500) + "\n...[생략됨]" : trimmed;
      logSnippet = `\n\n*📄 발생 에러 로그*\n\`\`\`\n${snippet}\n\`\`\``;
    }

    let prStatus: string;
    if (prUrls && prUrls.length > 0) {
      const parts: string[] = [];
      parts.push("🤖 *[AI 자동 코드 패치 후보]*\n문제를 감지하여 자동으로 코드를 수정하고 Pull Request(PR) 후보들을 생성했습니다. 개발팀의 검토가 필요합니다:\n");
      for (let i = 0; i < prUrls.length; i++) {
        const prUrl = prUrls[i];
        const candidate = aiResult.prCandidates && i < aiResult.prCandidates.length ? aiResult.prCandidates[i] : undefined;
        const patchSummary = candidate?.patchSummary || "코드 수정을 완료했습니다.";
        parts.push(`*후보 ${i + 1}*`);
        parts.push(`🛠️ *수정 내용*: ${patchSummary}`);
        parts.push(`👉 *PR 링크*: <${prUrl}|보기>\n`);
      }
      prStatus = parts.join("\n").trim();
    } else {
      const reason = aiResult.prNotNeededReason || "원인이 불명확하거나 소스코드 수정만으로는 해결할 수 없는 장애입니다.";
      let statusStr = `ℹ️ *[AI 자동 코드 패치 미생성 사유]*\n${reason}`;
      if (issueUrl) {
        statusStr += `\n\n📋 *[GitHub Issue 자동 생성 완료]*\n👉 *이슈 링크*: <${issueUrl}|GitHub 이슈 보기>`;
      } else {
        statusStr += `\n\n📋 *[GitHub Issue]* 별도 GitHub 이슈 생성이 필요하지 않은 건으로 판명되었습니다.`;
      }
      prStatus = statusStr;
    }

    return `${title}\n\n${context}\n\n*📌 핵심 요약*\n${summary}\n\n*⚠️ 위험도 및 서비스 영향*\n${impact}\n\n*💻 기술적 원인 분석*\n${cause}${logSnippet}\n\n${prStatus}`;
  }
}
