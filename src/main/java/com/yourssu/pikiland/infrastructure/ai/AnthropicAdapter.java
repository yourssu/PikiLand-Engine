package com.yourssu.pikiland.infrastructure.ai;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.model.PrCandidate;
import com.yourssu.pikiland.domain.port.AiAgentPort;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Path;
import java.util.*;

@Component("anthropicAdapter")
public class AnthropicAdapter implements AiAgentPort {

    private final String baseUrl;
    private final String apiKey;
    private final String defaultModel;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public AnthropicAdapter(
            @Value("${app.anthropic.base-url:https://api.anthropic.com/v1}") String baseUrl,
            @Value("${app.anthropic.api-key:}") String apiKey,
            @Value("${app.anthropic.model:claude-3-5-sonnet-20240620}") String defaultModel) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);
        this.objectMapper = new ObjectMapper()
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_COMMENTS, true)
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_UNQUOTED_FIELD_NAMES, true)
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_SINGLE_QUOTES, true);
    }

    @Override
    public AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel) {
        String model = (customModel != null && !customModel.isBlank()) ? customModel : defaultModel;
        System.out.println("Starting Anthropic AI diagnostics using model: " + model);

        String systemPrompt = "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n" +
                "당신은 오류의 맥락을 정확히 이해하기 위해 프로젝트 워크스페이스의 디렉토리와 파일을 탐색할 수 있는 도구(Tools)를 사용할 수 있습니다.\n" +
                "모든 분석이 완료되면 반드시 정의된 'submit_analysis' 도구(Tool)를 사용하여 결과를 최종 제출해야 합니다.\n\n" +
                "🌐 [언어 규칙]\n" +
                "모든 응답 필드('summary', 'impact', 'cause_description', 'patch_summary', 'pr_title', 'pr_body')는 반드시 **한국어**로만 작성하십시오.\n\n" +
                "📢 [Slack 알림 용 - 비개발자 대상 필드 규칙]\n" +
                "1. 'summary', 'impact', 'patch_summary' 필드는 기획자, PM, 운영팀 등 **비개발자**를 대상으로 합니다.\n" +
                "2. 개발/IT 전문 용어를 최대한 배제하거나 한글로 아주 쉽게 풀어서 설명해 주십시오.\n" +
                "3. 객관적이고 단순 명료하게 비개발자가 시스템 장애 현상과 고쳐진 방향을 한눈에 파악할 수 있게 하십시오.\n\n" +
                "💻 [GitHub PR 용 - 개발자 대상 필드 규칙]\n" +
                "1. 각 PR 후보 내의 'pr_title'과 'pr_body'는 코드 검토를 진행할 **개발자**들을 대상으로 합니다.\n" +
                "2. 에러의 기술적 원인, 스택 트레이스 상의 문제 지점, 수정사항의 기술적 타당성, 사이드 이펙트(부작용) 가능성 등을 개발자 전문 용어를 적극 사용하여 상세히 서술하십시오.\n" +
                "3. 필요 시 수정 코드 스니펫이나 원본 로그 스니펫을 PR 본문에 마크다운으로 포함시켜 개발자가 바로 검토할 수 있게 하십시오.\n\n" +
                "🤖 [중요 - PR 후보군(Candidates) 생성 규칙]\n" +
                "에러를 해결하기 위해 최대 3개의 서로 다른 PR 수정 후보(1개 ~ 3개)를 생성하십시오. 각 후보는 서로 다른 접근 방식이거나, 가장 유력한 시도들이어야 합니다. 당신이 해결책에 확신이 부족하더라도 사람이 검토할 수 있도록 가능한 한 PR 후보들을 3개까지 구체적으로 제안하여 'pr_candidates' 배열에 담아 주십시오.\n\n" +
                "⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]\n" +
                "1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열(\"test\")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.\n" +
                "2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.\n" +
                "3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.\n" +
                "4. **해결책의 불명확성 인지**: 로그나 정보가 부족하여 완전하고 근본적인 해결 코드를 제어할 수 없거나, 소스 코드 수정만으로는 불가능한 환경/인프라성 장애인 경우, 절대로 'pr_needed'를 false로 지정하고 'submit_analysis'를 제출하십시오.";

        String userPrompt = "이벤트 유형: " + eventType + "\n\n[분석할 데이터]\n" + logContent;

        List<Map<String, Object>> messages = new ArrayList<>();
        Map<String, Object> userMsg = new HashMap<>();
        userMsg.put("role", "user");
        userMsg.put("content", userPrompt);
        messages.add(userMsg);

        int fileCount = workspacePort.countSourceFiles(workspace);
        int maxIterations = Math.min(60, 15 + (fileCount / 30));
        System.out.println("[Anthropic] Repo source file count: " + fileCount + " → dynamic agent loop cap: " + maxIterations + " iterations");

        try {
            return runAgenticLoop(messages, systemPrompt, model, workspace, workspacePort, maxIterations);
        } catch (Exception e) {
            System.err.println("Anthropic agentic loop failed: " + e.getMessage());
            e.printStackTrace();
            return new AiAnalysisResult(false, "⚠️ Anthropic AI 분석 호출에 실패했습니다. 에러: " + e.getMessage(), "오류가 발생하여 분석하지 못했습니다.", "", false, Collections.emptyList());
        }
    }

    private AiAnalysisResult runAgenticLoop(List<Map<String, Object>> messages, String systemPrompt, String model, Path workspace, WorkspacePort workspacePort, int maxIterations) throws Exception {
        Map<String, Integer> toolCallHistory = new HashMap<>();
        int iteration = 0;

        while (true) {
            iteration++;
            System.out.println(" -> Anthropic Agentic Loop Iteration " + iteration + "/" + maxIterations);

            if (iteration > maxIterations) {
                throw new RuntimeException("Anthropic agentic loop exceeded dynamic cap of " + maxIterations + " iterations.");
            }

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);
            requestBody.put("system", systemPrompt);
            requestBody.put("messages", messages);
            requestBody.put("max_tokens", 4000);
            requestBody.put("temperature", 0.2);
            requestBody.put("tools", getToolsDefinitions());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("x-api-key", getEffectiveApiKey());
            headers.set("anthropic-version", "2023-06-01");

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            String url = getEffectiveBaseUrl() + "/messages";
            ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);

            if (response.getStatusCode() != HttpStatus.OK) {
                throw new RuntimeException("Anthropic API Call failed: " + response.getStatusCode() + " - " + response.getBody());
            }

            JsonNode responseRoot = objectMapper.readTree(response.getBody());
            JsonNode contentArray = responseRoot.path("content");

            // Extract Assistant response content
            List<Map<String, Object>> assistantContentBlocks = new ArrayList<>();
            JsonNode submitAnalysisCall = null;
            List<JsonNode> otherToolCalls = new ArrayList<>();

            for (JsonNode block : contentArray) {
                Map<String, Object> blockMap = objectMapper.convertValue(block, new TypeReference<Map<String, Object>>() {});
                assistantContentBlocks.add(blockMap);

                if ("tool_use".equals(block.path("type").asText())) {
                    String toolName = block.path("name").asText();
                    if ("submit_analysis".equals(toolName)) {
                        submitAnalysisCall = block;
                    } else {
                        otherToolCalls.add(block);
                    }
                }
            }

            Map<String, Object> assistantMsg = new HashMap<>();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("content", assistantContentBlocks);
            messages.add(assistantMsg);

            // 1. Check if submit_analysis tool was called (This triggers final output extraction)
            if (submitAnalysisCall != null) {
                System.out.println("   [Anthropic] submit_analysis tool called. Extracting results...");
                JsonNode input = submitAnalysisCall.path("input");

                boolean isConfident = input.path("is_confident").asBoolean();
                String summary = input.path("summary").asText();
                String impact = input.path("impact").asText();
                String causeDescription = input.path("cause_description").asText();
                boolean prNeeded = input.path("pr_needed").asBoolean();

                List<PrCandidate> prCandidates = new ArrayList<>();
                JsonNode candidateNodes = input.path("pr_candidates");
                if (candidateNodes.isArray()) {
                    for (JsonNode candidateNode : candidateNodes) {
                        List<PatchInstruction> patches = new ArrayList<>();
                        JsonNode patchNodes = candidateNode.path("patch_instructions");
                        if (patchNodes.isArray()) {
                            for (JsonNode patchNode : patchNodes) {
                                patches.add(new PatchInstruction(
                                        patchNode.path("file_path").asText(),
                                        patchNode.path("old_code").asText(),
                                        patchNode.path("new_code").asText()
                                ));
                            }
                        }
                        prCandidates.add(new PrCandidate(
                                candidateNode.path("patch_summary").asText(),
                                patches,
                                candidateNode.path("pr_title").asText(),
                                candidateNode.path("pr_body").asText()
                        ));
                    }
                }
                return new AiAnalysisResult(isConfident, summary, impact, causeDescription, prNeeded, prCandidates);
            }

            // 2. Handle other tool calls
            if (!otherToolCalls.isEmpty()) {
                List<Map<String, Object>> toolResponseBlocks = new ArrayList<>();
                for (JsonNode toolCall : otherToolCalls) {
                    String callId = toolCall.path("id").asText();
                    String funcName = toolCall.path("name").asText();
                    JsonNode funcArgs = toolCall.path("input");

                    String callKey = funcName + ":" + funcArgs.toString();
                    toolCallHistory.put(callKey, toolCallHistory.getOrDefault(callKey, 0) + 1);

                    if (toolCallHistory.get(callKey) >= 5) {
                        throw new RuntimeException("Infinite loop detected: tool " + funcName + " was called repeatedly 5 times with args " + funcArgs);
                    }

                    System.out.println("   [Tool Call] " + funcName + " args: " + funcArgs);
                    String result = "";

                    if ("list_directory".equals(funcName)) {
                        String dirPath = funcArgs.path("directory_path").asText(".");
                        result = workspacePort.listDirectory(workspace, dirPath);
                    } else if ("read_file_content".equals(funcName)) {
                        String filePath = funcArgs.path("file_path").asText();
                        result = workspacePort.readFile(workspace, filePath);
                    } else if ("grep_in_file".equals(funcName)) {
                        String filePath = funcArgs.path("file_path").asText();
                        String query = funcArgs.path("query").asText();
                        result = workspacePort.grepInFile(workspace, filePath, query);
                    } else {
                        result = "Error: Tool " + funcName + " is not recognized.";
                    }

                    Map<String, Object> toolResponseBlock = new HashMap<>();
                    toolResponseBlock.put("type", "tool_result");
                    toolResponseBlock.put("tool_use_id", callId);
                    toolResponseBlock.put("content", result);
                    toolResponseBlocks.add(toolResponseBlock);
                }

                Map<String, Object> userMsg = new HashMap<>();
                userMsg.put("role", "user");
                userMsg.put("content", toolResponseBlocks);
                messages.add(userMsg);
            } else {
                // No tool call returned. Attempt Text Fallback from Assistant response before requesting tool invocation.
                StringBuilder textBuf = new StringBuilder();
                if (contentArray.isArray()) {
                    for (JsonNode block : contentArray) {
                        if ("text".equals(block.path("type").asText())) {
                            textBuf.append(block.path("text").asText()).append("\n");
                        }
                    }
                }
                String textOutput = textBuf.toString().trim();

                if (!textOutput.isBlank() && textOutput.contains("{") && textOutput.contains("}")) {
                    try {
                        System.out.println("   [Anthropic] Assistant returned text instead of tool invocation. Attempting Prompt-based Text Fallback...");
                        return parseTextFallback(textOutput);
                    } catch (Exception ex) {
                        System.err.println("   [Anthropic] Text fallback parsing failed: " + ex.getMessage());
                    }
                }

                System.out.println("   [Anthropic] Assistant returned text but did not call submit_analysis. Requesting tool invocation...");
                Map<String, Object> promptMsg = new HashMap<>();
                promptMsg.put("role", "user");
                promptMsg.put("content", "최종 제출을 위해 반드시 'submit_analysis' 도구를 호출해 주십시오.");
                messages.add(promptMsg);
            }
        }
    }

    private AiAnalysisResult parseTextFallback(String rawText) throws Exception {
        String jsonStr = rawText.trim();
        if (jsonStr.startsWith("```")) {
            int firstNewline = jsonStr.indexOf('\n');
            int lastBackticks = jsonStr.lastIndexOf("```");
            if (firstNewline != -1 && lastBackticks > firstNewline) {
                jsonStr = jsonStr.substring(firstNewline + 1, lastBackticks).trim();
            }
        }
        if (!(jsonStr.startsWith("{") && jsonStr.endsWith("}"))) {
            int firstBrace = jsonStr.indexOf("{");
            int lastBrace = jsonStr.lastIndexOf("}");
            if (firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }
        }
        JsonNode candidateNode = objectMapper.readTree(jsonStr);

        boolean isConfident = candidateNode.path("is_confident").asBoolean(true);
        String summary = candidateNode.path("summary").asText("");
        String impact = candidateNode.path("impact").asText("");
        String causeDescription = candidateNode.path("cause_description").asText("");
        boolean prNeeded = candidateNode.path("pr_needed").asBoolean(false);

        List<PrCandidate> prCandidates = new ArrayList<>();
        JsonNode prCandidatesNode = candidateNode.path("pr_candidates");
        if (prCandidatesNode.isArray()) {
            for (JsonNode cand : prCandidatesNode) {
                List<PatchInstruction> patches = new ArrayList<>();
                JsonNode patchInstructionsNode = cand.path("patch_instructions");
                if (patchInstructionsNode.isArray()) {
                    for (JsonNode inst : patchInstructionsNode) {
                        patches.add(new PatchInstruction(
                                inst.path("file_path").asText(),
                                inst.path("old_code").asText(),
                                inst.path("new_code").asText()
                        ));
                    }
                }
                prCandidates.add(new PrCandidate(
                        cand.path("patch_summary").asText(),
                        patches,
                        cand.path("pr_title").asText(),
                        cand.path("pr_body").asText()
                ));
            }
        }
        return new AiAnalysisResult(isConfident, summary, impact, causeDescription, prNeeded, prCandidates);
    }

    private List<Map<String, Object>> getToolsDefinitions() {
        List<Map<String, Object>> tools = new ArrayList<>();

        // list_directory
        Map<String, Object> t1 = new HashMap<>();
        t1.put("name", "list_directory");
        t1.put("description", "Lists subdirectories and files in a single-level folder path inside the project workspace.");
        Map<String, Object> p1 = new HashMap<>();
        p1.put("type", "object");
        Map<String, Object> prop1 = new HashMap<>();
        Map<String, Object> dirPathProp = new HashMap<>();
        dirPathProp.put("type", "string");
        dirPathProp.put("description", "Relative directory path from project root (e.g. '.', 'src', 'src/main/java'). Defaults to '.'.");
        prop1.put("directory_path", dirPathProp);
        p1.put("properties", prop1);
        t1.put("input_schema", p1);
        tools.add(t1);

        // read_file_content
        Map<String, Object> t2 = new HashMap<>();
        t2.put("name", "read_file_content");
        t2.put("description", "Reads the source code content of a specific file in the workspace.");
        Map<String, Object> p2 = new HashMap<>();
        p2.put("type", "object");
        Map<String, Object> prop2 = new HashMap<>();
        Map<String, Object> filePathProp = new HashMap<>();
        filePathProp.put("type", "string");
        filePathProp.put("description", "Relative file path from project root (e.g. 'src/test/java/DemoApplicationTests.java').");
        prop2.put("file_path", filePathProp);
        p2.put("properties", prop2);
        p2.put("required", Arrays.asList("file_path"));
        t2.put("input_schema", p2);
        tools.add(t2);

        // grep_in_file
        Map<String, Object> t3 = new HashMap<>();
        t3.put("name", "grep_in_file");
        t3.put("description", "Searches for a specific query or symbol inside a single file to locate reference details.");
        Map<String, Object> p3 = new HashMap<>();
        p3.put("type", "object");
        Map<String, Object> prop3 = new HashMap<>();
        Map<String, Object> pathProp = new HashMap<>();
        pathProp.put("type", "string");
        pathProp.put("description", "Relative file path from project root.");
        Map<String, Object> queryProp = new HashMap<>();
        queryProp.put("type", "string");
        queryProp.put("description", "The exact term or symbol to search for (e.g. 'User').");
        prop3.put("file_path", pathProp);
        prop3.put("query", queryProp);
        p3.put("properties", prop3);
        p3.put("required", Arrays.asList("file_path", "query"));
        t3.put("input_schema", p3);
        tools.add(t3);

        // submit_analysis
        Map<String, Object> t4 = new HashMap<>();
        t4.put("name", "submit_analysis");
        t4.put("description", "Submit the final diagnostic analysis and patch candidates.");
        Map<String, Object> p4 = new HashMap<>();
        p4.put("type", "object");
        Map<String, Object> prop4 = new HashMap<>();
        prop4.put("is_confident", Map.of("type", "boolean", "description", "분석 및 패치 성공 확신 여부"));
        prop4.put("summary", Map.of("type", "string", "description", "에러 핵심 요약 (비개발자용)"));
        prop4.put("impact", Map.of("type", "string", "description", "장애 전파 범위 및 영향도 (비개발자용)"));
        prop4.put("cause_description", Map.of("type", "string", "description", "기술적 분석 및 수정 방안 (개발자 마크다운)"));
        prop4.put("pr_needed", Map.of("type", "boolean", "description", "코드 자동 패치가 필요한지 여부"));

        Map<String, Object> prCandidates = new HashMap<>();
        prCandidates.put("type", "array");
        prCandidates.put("description", "최대 3개의 서로 다른 PR 수정 후보군 (확신도가 낮더라도 제안)");

        Map<String, Object> candidateItem = new HashMap<>();
        candidateItem.put("type", "object");
        Map<String, Object> candidateProps = new HashMap<>();
        candidateProps.put("patch_summary", Map.of("type", "string", "description", "이 후보의 수정 요약 (비개발자용)"));
        candidateProps.put("pr_title", Map.of("type", "string", "description", "이 후보 PR의 제목"));
        candidateProps.put("pr_body", Map.of("type", "string", "description", "이 후보 PR의 본문 (설명 포함)"));

        Map<String, Object> patchInstructions = new HashMap<>();
        patchInstructions.put("type", "array");
        Map<String, Object> patchItem = new HashMap<>();
        patchItem.put("type", "object");
        Map<String, Object> patchItemProps = new HashMap<>();
        patchItemProps.put("file_path", Map.of("type", "string", "description", "파일 경로"));
        patchItemProps.put("old_code", Map.of("type", "string", "description", "기존 소스코드 일부 (완벽히 일치해야 함)"));
        patchItemProps.put("new_code", Map.of("type", "string", "description", "교체될 새 소스코드"));
        patchItem.put("properties", patchItemProps);
        patchItem.put("required", Arrays.asList("file_path", "old_code", "new_code"));
        patchInstructions.put("items", patchItem);

        candidateProps.put("patch_instructions", patchInstructions);
        candidateItem.put("properties", candidateProps);
        candidateItem.put("required", Arrays.asList("patch_summary", "patch_instructions", "pr_title", "pr_body"));

        prCandidates.put("items", candidateItem);
        prop4.put("pr_candidates", prCandidates);

        p4.put("properties", prop4);
        p4.put("required", Arrays.asList("is_confident", "summary", "impact", "cause_description", "pr_needed", "pr_candidates"));
        t4.put("input_schema", p4);
        tools.add(t4);

        return tools;
    }

    @Override
    public AiAnalysisResult refinePatch(
            String originalLogContent,
            String eventType,
            Path workspace,
            WorkspacePort workspacePort,
            String customModel,
            List<PatchInstruction> failedPatches,
            String harnessFailureLog) {
        String model = (customModel != null && !customModel.isBlank()) ? customModel : defaultModel;
        System.out.println("Starting Anthropic AI patch refinement using model: " + model);

        String systemPrompt = "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n" +
                "당신은 오류의 맥락을 정확히 이해하기 위해 프로젝트 워크스페이스의 디렉토리와 파일을 탐색할 수 있는 도구(Tools)를 사용할 수 있습니다.\n" +
                "모든 분석이 완료되면 반드시 정의된 'submit_analysis' 도구(Tool)를 사용하여 결과를 최종 제출해야 합니다.";

        List<Map<String, Object>> messages = new ArrayList<>();

        Map<String, Object> userMsg1 = new HashMap<>();
        userMsg1.put("role", "user");
        userMsg1.put("content", "이벤트 유형: " + eventType + "\n\n[분석할 데이터]\n" + originalLogContent);
        messages.add(userMsg1);

        // Assistant proposes failed patch
        StringBuilder failedPatchDesc = new StringBuilder("제가 제안했던 패치 내역입니다:\n");
        for (PatchInstruction patch : failedPatches) {
            failedPatchDesc.append("- 파일: ").append(patch.getFilePath()).append("\n");
            failedPatchDesc.append("  [기존 코드]\n").append(patch.getOldCode()).append("\n");
            failedPatchDesc.append("  [변경 코드]\n").append(patch.getNewCode()).append("\n");
        }

        List<Map<String, Object>> assistantContent = new ArrayList<>();
        Map<String, Object> textBlock = new HashMap<>();
        textBlock.put("type", "text");
        textBlock.put("text", failedPatchDesc.toString());
        assistantContent.add(textBlock);

        Map<String, Object> assistantMsg = new HashMap<>();
        assistantMsg.put("role", "assistant");
        assistantMsg.put("content", assistantContent);
        messages.add(assistantMsg);

        // User reports harness failure
        Map<String, Object> userMsg2 = new HashMap<>();
        userMsg2.put("role", "user");
        userMsg2.put("content", "제안해주신 패치를 적용하고 테스트 하네스(Harness)를 실행했으나 실패했습니다.\n" +
                "아래는 테스트 실행 시 발생한 에러 로그입니다:\n\n" +
                "```\n" + harnessFailureLog + "\n```\n\n" +
                "테스트 실패 원인과 제안했던 패치 코드를 다시 분석하여, 이를 수정한 새로운 보완 패치(refinement patch)를 제안해 주십시오.");
        messages.add(userMsg2);

        int fileCount = workspacePort.countSourceFiles(workspace);
        int maxIterations = Math.min(60, 15 + (fileCount / 30));

        try {
            return runAgenticLoop(messages, systemPrompt, model, workspace, workspacePort, maxIterations);
        } catch (Exception e) {
            System.err.println("Anthropic patch refinement failed: " + e.getMessage());
            e.printStackTrace();
            return new AiAnalysisResult(false, "⚠️ Anthropic AI refinement failed. Error: " + e.getMessage(), "오류 발생", "", false, Collections.emptyList());
        }
    }

    private String getEffectiveBaseUrl() {
        String envBaseUrl = System.getenv("PIKILAND_AI_BASE_URL");
        if (envBaseUrl != null && !envBaseUrl.isBlank()) {
            return envBaseUrl;
        }
        return (this.baseUrl != null && !this.baseUrl.isBlank()) ? this.baseUrl : "https://api.anthropic.com/v1";
    }

    private String getEffectiveApiKey() {
        String envKey = System.getenv("ANTHROPIC_API_KEY");
        if (envKey != null && !envKey.isBlank()) {
            return envKey;
        }
        return this.apiKey;
    }
}
