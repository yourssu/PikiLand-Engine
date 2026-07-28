package com.yourssu.pikiland.domain.port;

import java.util.Map;

public interface GithubAuthPort {
    String getInstallationAccessToken(long installationId);
    String createPullRequest(String repo, String title, String body, String headBranch, String baseBranch, String token);
    String downloadWorkflowLogs(String repo, String runId, String token);
    String fetchIssueBody(String repo, String issueNumber, String token);
    void triggerWorkflowDispatch(String repo, String workflowId, String ref, Map<String, Object> inputs, String token);
    void installWorkflowIfMissing(String repo, String token, String defaultBranch);
    boolean isAppInstalledForRepo(String repo);
    java.util.Set<String> getInstalledRepositoryFullNames(String userAccessToken);
    String getInstallationAccessTokenForRepo(String repo);
}
