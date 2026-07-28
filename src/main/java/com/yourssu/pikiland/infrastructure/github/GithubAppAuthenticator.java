package com.yourssu.pikiland.infrastructure.github;

import com.yourssu.pikiland.domain.port.GithubAuthPort;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Component
public class GithubAppAuthenticator implements GithubAuthPort {

    private final String appId;
    private final String privateKeyPath;

    /** Default RestTemplate: follows redirects (used for most API calls). */
    private final RestTemplate restTemplate;

    /**
     * No-redirect RestTemplate used exclusively for the workflow-log download.
     */
    private final RestTemplate noRedirectRestTemplate;

    public GithubAppAuthenticator(
            @Value("${app.github.app-id:}") String appId,
            @Value("${app.github.private-key-path:github-app-private-key.pem}") String privateKeyPath) {
        this.appId = appId;
        this.privateKeyPath = privateKeyPath;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);

        SimpleClientHttpRequestFactory noRedirectFactory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(java.net.HttpURLConnection connection, String httpMethod) throws java.io.IOException {
                super.prepareConnection(connection, httpMethod);
                connection.setInstanceFollowRedirects(false);
            }
        };
        noRedirectFactory.setConnectTimeout(10000);
        noRedirectFactory.setReadTimeout(60000);
        this.noRedirectRestTemplate = new RestTemplate(noRedirectFactory);
    }

    private PrivateKey getPrivateKey() throws Exception {
        String keyContent = null;
        if (privateKeyPath != null && !privateKeyPath.isBlank() && Files.exists(Paths.get(privateKeyPath))) {
            byte[] keyBytes = Files.readAllBytes(Paths.get(privateKeyPath));
            keyContent = new String(keyBytes, StandardCharsets.UTF_8);
        }

        if (keyContent == null || keyContent.isBlank()) {
            throw new IllegalStateException("GitHub App Private Key is missing.");
        }

        boolean isPkcs1 = keyContent.contains("BEGIN RSA PRIVATE KEY");

        String temp = keyContent
                .replaceAll("-----BEGIN PRIVATE KEY-----", "")
                .replaceAll("-----END PRIVATE KEY-----", "")
                .replaceAll("-----BEGIN RSA PRIVATE KEY-----", "")
                .replaceAll("-----END RSA PRIVATE KEY-----", "")
                .replaceAll("\\s+", "");

        byte[] decode = Base64.getDecoder().decode(temp);

        if (isPkcs1) {
            decode = convertPkcs1ToPkcs8(decode);
        }

        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(decode);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        return kf.generatePrivate(spec);
    }

    private byte[] convertPkcs1ToPkcs8(byte[] pkcs1Bytes) {
        int pkcs1Length = pkcs1Bytes.length;
        byte[] pkcs8Header;
        if (pkcs1Length < 128) {
            pkcs8Header = new byte[] {
                0x30, (byte) (pkcs1Length + 22),
                0x02, 0x01, 0x00,
                0x30, 0x0d, 0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
                0x04, (byte) pkcs1Length
            };
        } else if (pkcs1Length < 256) {
            pkcs8Header = new byte[] {
                0x30, (byte) 0x81, (byte) (pkcs1Length + 22),
                0x02, 0x01, 0x00,
                0x30, 0x0d, 0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
                0x04, (byte) 0x81, (byte) pkcs1Length
            };
        } else {
            int len = pkcs1Length + 22;
            pkcs8Header = new byte[] {
                0x30, (byte) 0x82, (byte) (len >> 8), (byte) (len & 0xff),
                0x02, 0x01, 0x00,
                0x30, 0x0d, 0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
                0x04, (byte) 0x82, (byte) (pkcs1Length >> 8), (byte) (pkcs1Length & 0xff)
            };
        }
        byte[] pkcs8Bytes = new byte[pkcs8Header.length + pkcs1Length];
        System.arraycopy(pkcs8Header, 0, pkcs8Bytes, 0, pkcs8Header.length);
        System.arraycopy(pkcs1Bytes, 0, pkcs8Bytes, pkcs8Header.length, pkcs1Length);
        return pkcs8Bytes;
    }

    private String generateJwt() {
        try {
            PrivateKey privateKey = getPrivateKey();
            String effAppId = (appId != null && !appId.isBlank()) ? appId : "123456";
            return Jwts.builder()
                    .issuedAt(new Date(System.currentTimeMillis() - 60000))
                    .expiration(new Date(System.currentTimeMillis() + 600000))
                    .issuer(effAppId)
                    .signWith(privateKey, Jwts.SIG.RS256)
                    .compact();
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate JWT for GitHub App: " + e.getMessage(), e);
        }
    }

    @Override
    public String getInstallationAccessToken(long installationId) {
        String jwt = generateJwt();
        String url = "https://api.github.com/app/installations/" + installationId + "/access_tokens";

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + jwt);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.CREATED && response.getBody() != null) {
                return (String) response.getBody().get("token");
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch Installation Access Token for installation " + installationId, e);
        }
        throw new RuntimeException("Failed to acquire token: Empty response.");
    }

    @Override
    public String createPullRequest(String repo, String title, String body, String headBranch, String baseBranch, String token) {
        String url = "https://api.github.com/repos/" + repo + "/pulls";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, String> payload = new HashMap<>();
            payload.put("title", title);
            payload.put("body", body);
            payload.put("head", headBranch);
            payload.put("base", baseBranch);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.CREATED && response.getBody() != null) {
                return (String) response.getBody().get("html_url");
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to create Pull Request for repo " + repo, e);
        }
        return null;
    }

    @Override
    public String downloadWorkflowLogs(String repo, String runId, String token) {
        String url = "https://api.github.com/repos/" + repo + "/actions/runs/" + runId + "/logs";
        try {
            HttpHeaders githubHeaders = new HttpHeaders();
            githubHeaders.set("Authorization", "Bearer " + token);
            githubHeaders.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> githubEntity = new HttpEntity<>(githubHeaders);

            ResponseEntity<byte[]> initialResponse;
            try {
                initialResponse = noRedirectRestTemplate.exchange(url, HttpMethod.GET, githubEntity, byte[].class);
            } catch (Exception ex) {
                throw new RuntimeException("Initial GitHub logs request failed", ex);
            }

            byte[] zipBytes = null;

            if (initialResponse.getStatusCode() == HttpStatus.OK && initialResponse.getBody() != null) {
                zipBytes = initialResponse.getBody();
            } else if (initialResponse.getStatusCode().is3xxRedirection()) {
                String s3Url = initialResponse.getHeaders().getFirst(HttpHeaders.LOCATION);
                if (s3Url == null || s3Url.isBlank()) {
                    throw new RuntimeException("GitHub returned 302 but no Location header for run " + runId);
                }
                System.out.println("[GitHub] Following log redirect to S3 (auth header stripped): " + s3Url.substring(0, Math.min(80, s3Url.length())) + "...");
                ResponseEntity<byte[]> s3Response = restTemplate.exchange(
                        s3Url, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), byte[].class);
                if (s3Response.getStatusCode() == HttpStatus.OK && s3Response.getBody() != null) {
                    zipBytes = s3Response.getBody();
                } else {
                    throw new RuntimeException("S3 log download failed: " + s3Response.getStatusCode());
                }
            } else {
                throw new RuntimeException("Unexpected response from GitHub logs endpoint: " + initialResponse.getStatusCode());
            }

            StringBuilder logBuilder = new StringBuilder();
            long totalBytes = 0;
            int entryCount = 0;
            long maxBytes = 50 * 1024 * 1024; // 50MB
            int maxEntries = 500;

            try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    entryCount++;
                    if (entryCount > maxEntries) {
                        System.err.println("[Zip Guard] Exceeded max allowed entries limit (" + maxEntries + "). Truncating log unzipping.");
                        break;
                    }

                    if (entry.getName().endsWith(".txt") || !entry.getName().contains("/")) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(zis, StandardCharsets.UTF_8));
                        String line;
                        logBuilder.append("=== File: ").append(entry.getName()).append(" ===\n");
                        while ((line = br.readLine()) != null) {
                            totalBytes += line.getBytes(StandardCharsets.UTF_8).length;
                            if (totalBytes > maxBytes) {
                                System.err.println("[Zip Guard] Exceeded max allowed size limit (50MB). Truncating log unzipping.");
                                logBuilder.append("\n... [Log Truncated - Reached maximum allowed 50MB uncompressed limit] ...\n");
                                return logBuilder.toString();
                            }
                            logBuilder.append(line).append("\n");
                        }
                        logBuilder.append("\n");
                    }
                }
            }
            return logBuilder.toString();

        } catch (Exception e) {
            throw new RuntimeException("Failed to download workflow logs for run " + runId, e);
        }
    }

    @Override
    public String fetchIssueBody(String repo, String issueNumber, String token) {
        String url = "https://api.github.com/repos/" + repo + "/issues/" + issueNumber;
        try {
            HttpHeaders headers = new HttpHeaders();
            if (token != null && !token.isBlank()) {
                headers.set("Authorization", "Bearer " + token);
            }
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                String body = (String) response.getBody().get("body");
                String title = (String) response.getBody().get("title");
                return "Issue #" + issueNumber + " Title: " + (title != null ? title : "") + "\n\n" + (body != null ? body : "");
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch issue body for issue #" + issueNumber + " in " + repo + ": " + e.getMessage());
        }
        return "";
    }

    @Override
    public void triggerWorkflowDispatch(String repo, String workflowId, String ref, Map<String, Object> inputs, String token) {
        String url = "https://api.github.com/repos/" + repo + "/actions/workflows/" + workflowId + "/dispatches";
        int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                HttpHeaders headers = new HttpHeaders();
                headers.set("Authorization", "Bearer " + token);
                headers.set("Accept", "application/vnd.github+json");
                headers.setContentType(MediaType.APPLICATION_JSON);

                Map<String, Object> payload = new HashMap<>();
                payload.put("ref", ref);
                payload.put("inputs", inputs);

                HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
                restTemplate.postForEntity(url, entity, Void.class);
                System.out.println("Successfully triggered workflow dispatch '" + workflowId + "' on ref " + ref + " for repo " + repo);
                return;
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                if (attempt < maxRetries) {
                    System.out.println("[GitHub Dispatch] Workflow '" + workflowId + "' not yet indexed (404). Retrying in 2 seconds (Attempt " + attempt + "/" + maxRetries + ")...");
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                } else {
                    throw new RuntimeException("Failed to trigger Workflow Dispatch for repo " + repo + " after " + maxRetries + " attempts", e);
                }
            } catch (org.springframework.web.client.HttpClientErrorException.UnprocessableEntity e) {
                String respBody = e.getResponseBodyAsString();
                System.err.println("[GitHub Dispatch] 422 Unprocessable Entity for repo " + repo + ": " + respBody);
                if (respBody != null && respBody.contains("Unexpected inputs provided:") && inputs != null && !inputs.isEmpty()) {
                    System.out.println("[GitHub Dispatch Fallback] Stripping unsupported inputs and retrying workflow dispatch for repo " + repo + "...");
                    Map<String, Object> sanitizedInputs = sanitizeInputsFromResponseBody(inputs, respBody);
                    if (sanitizedInputs.size() < inputs.size()) {
                        inputs = sanitizedInputs;
                        continue;
                    }
                }
                throw new RuntimeException("Failed to trigger Workflow Dispatch for repo " + repo + " (422 Unprocessable Entity)", e);
            } catch (Exception e) {
                throw new RuntimeException("Failed to trigger Workflow Dispatch for repo " + repo, e);
            }
        }
    }

    private Map<String, Object> sanitizeInputsFromResponseBody(Map<String, Object> originalInputs, String responseBody) {
        Map<String, Object> copy = new HashMap<>(originalInputs);
        try {
            int idx = responseBody.indexOf("Unexpected inputs provided:");
            if (idx != -1) {
                int startBracket = responseBody.indexOf("[", idx);
                int endBracket = responseBody.indexOf("]", startBracket);
                if (startBracket != -1 && endBracket != -1) {
                    String rawKeysStr = responseBody.substring(startBracket + 1, endBracket);
                    String[] keys = rawKeysStr.split(",");
                    for (String key : keys) {
                        String cleanKey = key.replaceAll("[^a-zA-Z0-9_-]", "").trim();
                        if (!cleanKey.isEmpty()) {
                            System.out.println("[GitHub Dispatch Fallback] Removing unsupported input key: '" + cleanKey + "'");
                            copy.remove(cleanKey);
                        }
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[GitHub Dispatch Fallback] Failed to parse 422 response body: " + e.getMessage());
        }
        return copy;
    }

    @Override
    public void installWorkflowIfMissing(String repo, String token, String defaultBranch) {
        String path = ".github/workflows/pikiland.yml";
        String checkUrl = "https://api.github.com/repos/" + repo + "/contents/" + path + "?ref=" + defaultBranch;
        String yaml = buildWorkflowYaml();

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            try {
                ResponseEntity<Map> response = restTemplate.exchange(checkUrl, HttpMethod.GET, entity, Map.class);
                if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                    Map body = response.getBody();
                    String sha = (String) body.get("sha");
                    String content = (String) body.get("content");
                    String decodedContent = content != null ? new String(Base64.getMimeDecoder().decode(content.replaceAll("\\s+", ""))) : "";

                    if (decodedContent.contains("ralph_max_retries:") && decodedContent.contains("pikiland-engine") && decodedContent.contains("spring.profiles.active=local")) {
                        System.out.println("[GitHub] pikiland.yml already up-to-date in " + repo);
                        return;
                    }

                    System.out.println("[GitHub] Outdated pikiland.yml detected in " + repo + ". Updating to latest workflow template...");
                    updateWorkflowFile(repo, path, sha, yaml, token, defaultBranch);
                    return;
                }
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                System.out.println("[GitHub] pikiland.yml not found in " + repo + ". Installing...");
                updateWorkflowFile(repo, path, null, yaml, token, defaultBranch);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to check/install workflow file in " + repo, e);
        }
    }

    private void updateWorkflowFile(String repo, String path, String sha, String yamlContent, String token, String branch) {
        String installUrl = "https://api.github.com/repos/" + repo + "/contents/" + path;
        String base64Content = Base64.getEncoder().encodeToString(yamlContent.getBytes(StandardCharsets.UTF_8));

        Map<String, Object> body = new HashMap<>();
        body.put("message", sha == null ? "ci: install PikiLand self-healing workflow" : "ci: update PikiLand self-healing workflow");
        body.put("content", base64Content);
        body.put("branch", branch);
        if (sha != null) {
            body.put("sha", sha);
        }

        HttpHeaders putHeaders = new HttpHeaders();
        putHeaders.set("Authorization", "Bearer " + token);
        putHeaders.set("Accept", "application/vnd.github+json");
        putHeaders.setContentType(MediaType.APPLICATION_JSON);

        HttpEntity<Map<String, Object>> putEntity = new HttpEntity<>(body, putHeaders);
        restTemplate.exchange(installUrl, HttpMethod.PUT, putEntity, Map.class);
        System.out.println("[GitHub] Successfully " + (sha == null ? "installed" : "updated") + " pikiland.yml in " + repo + " on branch " + branch);
    }

    private String buildWorkflowYaml() {
        return "name: PikiLand Self-Healing\n" +
                "\n" +
                "on:\n" +
                "  workflow_dispatch:\n" +
                "    inputs:\n" +
                "      event_type:\n" +
                "        description: 'Original event type'\n" +
                "        required: true\n" +
                "      log_content:\n" +
                "        description: 'Truncated error log or issue body (Optional - CLI downloads via run_id if omitted)'\n" +
                "        required: false\n" +
                "      run_id:\n" +
                "        description: 'Original run ID or issue number'\n" +
                "        required: true\n" +
                "      target_branch:\n" +
                "        description: 'Branch to checkout and patch'\n" +
                "        required: true\n" +
                "      slack_webhook_url:\n" +
                "        description: 'Slack Webhook URL'\n" +
                "        required: false\n" +
                "      ai_model:\n" +
                "        description: 'AI model name'\n" +
                "        required: false\n" +
                "      ai_base_url:\n" +
                "        description: 'Custom AI API Base URL'\n" +
                "        required: false\n" +
                "      harness_cmd:\n" +
                "        description: 'Command to run harness verification (e.g. ./gradlew test)'\n" +
                "        required: false\n" +
                "      ralph_max_retries:\n" +
                "        description: 'Ralph Loop max retries cap'\n" +
                "        required: false\n" +
                "\n" +
                "jobs:\n" +
                "  pikiland-patch:\n" +
                "    runs-on: ubuntu-latest\n" +
                "    steps:\n" +
                "      - name: Checkout Target Repository\n" +
                "        uses: actions/checkout@v4\n" +
                "        with:\n" +
                "          ref: ${{ github.event.inputs.target_branch }}\n" +
                "          fetch-depth: 0\n" +
                "\n" +
                "      - name: Checkout PikiLand Engine\n" +
                "        uses: actions/checkout@v4\n" +
                "        with:\n" +
                "          repository: 'yourssu/PikiLand-Engine'\n" +
                "          ref: 'main'\n" +
                "          path: 'pikiland-engine'\n" +
                "          token: ${{ secrets.PIKILAND_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}\n" +
                "\n" +
                "      - name: Set up Java 21\n" +
                "        uses: actions/setup-java@v4\n" +
                "        with:\n" +
                "          java-version: '21'\n" +
                "          distribution: 'temurin'\n" +
                "\n" +
                "      - name: Run PikiLand CLI (Native Execution)\n" +
                "        env:\n" +
                "          PIKILAND_CLI: \"true\"\n" +
                "          PIKILAND_EVENT_TYPE: \"${{ github.event.inputs.event_type }}\"\n" +
                "          PIKILAND_LOG_CONTENT: \"${{ github.event.inputs.log_content }}\"\n" +
                "          PIKILAND_RUN_ID: \"${{ github.event.inputs.run_id }}\"\n" +
                "          PIKILAND_TARGET_BRANCH: \"${{ github.event.inputs.target_branch }}\"\n" +
                "          PIKILAND_WORKSPACE_PATH: \"${{ github.workspace }}\"\n" +
                "          PIKILAND_HARNESS_CMD: \"${{ github.event.inputs.harness_cmd }}\"\n" +
                "          PIKILAND_RALPH_MAX_RETRIES: \"${{ github.event.inputs.ralph_max_retries }}\"\n" +
                "          GITHUB_TOKEN: \"${{ secrets.GITHUB_TOKEN }}\"\n" +
                "          GITHUB_REPOSITORY: \"${{ github.repository }}\"\n" +
                "          SLACK_WEBHOOK_URL: \"${{ github.event.inputs.slack_webhook_url }}\"\n" +
                "          AI_MODEL: \"${{ github.event.inputs.ai_model }}\"\n" +
                "          PIKILAND_AI_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\"\n" +
                "          OPENAI_API_KEY: \"${{ secrets.OPENAI_API_KEY || secrets.PIKILAND_AI_API_KEY }}\"\n" +
                "          ANTHROPIC_API_KEY: \"${{ secrets.ANTHROPIC_API_KEY || secrets.PIKILAND_AI_API_KEY }}\"\n" +
                "        run: |\n" +
                "          cd pikiland-engine\n" +
                "          chmod +x gradlew\n" +
                "          ./gradlew bootRun --args=\"--cli --spring.profiles.active=local\"\n";
    }

    @Override
    public boolean isAppInstalledForRepo(String repo) {
        if (repo == null || !repo.contains("/")) return false;
        try {
            String jwt = generateJwt();
            String url = "https://api.github.com/repos/" + repo + "/installation";
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + jwt);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            return response.getStatusCode() == HttpStatus.OK && response.getBody() != null && response.getBody().containsKey("id");
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public java.util.Set<String> getInstalledRepositoryFullNames(String userAccessToken) {
        java.util.Set<String> installedRepos = new java.util.HashSet<>();
        if (userAccessToken == null || userAccessToken.isBlank()) {
            return installedRepos;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + userAccessToken);
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);

            String installationsUrl = "https://api.github.com/user/installations";
            ResponseEntity<Map> resp = restTemplate.exchange(installationsUrl, HttpMethod.GET, entity, Map.class);
            if (resp.getStatusCode() == HttpStatus.OK && resp.getBody() != null) {
                java.util.List<Map<String, Object>> installations = (java.util.List<Map<String, Object>>) resp.getBody().get("installations");
                if (installations != null) {
                    for (Map<String, Object> inst : installations) {
                        Object instIdObj = inst.get("id");
                        if (instIdObj != null) {
                            long instId = ((Number) instIdObj).longValue();
                            String repoUrl = "https://api.github.com/user/installations/" + instId + "/repositories?per_page=100";
                            ResponseEntity<Map> repoResp = restTemplate.exchange(repoUrl, HttpMethod.GET, entity, Map.class);
                            if (repoResp.getStatusCode() == HttpStatus.OK && repoResp.getBody() != null) {
                                java.util.List<Map<String, Object>> reposList = (java.util.List<Map<String, Object>>) repoResp.getBody().get("repositories");
                                if (reposList != null) {
                                    for (Map<String, Object> r : reposList) {
                                        String fn = (String) r.get("full_name");
                                        if (fn != null) {
                                            installedRepos.add(fn);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[GitHubAuth] Failed to batch fetch user app installations: " + e.getMessage());
        }
        return installedRepos;
    }

    @Override
    public String getInstallationAccessTokenForRepo(String repo) {
        if (repo == null || !repo.contains("/")) return null;
        try {
            String jwt = generateJwt();
            String url = "https://api.github.com/repos/" + repo + "/installation";
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + jwt);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Object idObj = response.getBody().get("id");
                if (idObj != null) {
                    long installationId = ((Number) idObj).longValue();
                    return getInstallationAccessToken(installationId);
                }
            }
        } catch (Exception e) {
            System.err.println("[GitHubAuth] Failed to fetch installation token for " + repo + ": " + e.getMessage());
        }
        return null;
    }
}
