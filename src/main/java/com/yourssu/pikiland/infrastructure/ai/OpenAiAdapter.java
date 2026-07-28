package com.yourssu.pikiland.infrastructure.ai;

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

@Component("openAiAdapter")
public class OpenAiAdapter implements AiAgentPort {

    private final String baseUrl;
    private final String apiKey;
    private final String defaultModel;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public OpenAiAdapter(
            @Value("${app.ai.base-url}") String baseUrl,
            @Value("${app.ai.api-key:}") String apiKey,
            @Value("${app.ai.model:gpt-4o}") String defaultModel,
            Optional<RestTemplate> restTemplateOpt) { // Injected Optional RestTemplate
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.restTemplate = restTemplateOpt.orElseGet(() -> {
            org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(10000);
            factory.setReadTimeout(60000);
            return new RestTemplate(factory);
        });
        this.objectMapper = new ObjectMapper()
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_COMMENTS, true)
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_UNQUOTED_FIELD_NAMES, true)
                .configure(com.fasterxml.jackson.core.JsonParser.Feature.ALLOW_SINGLE_QUOTES, true);
    }

    public enum ResponseMode {
        STRUCTURED_SCHEMA,
        JSON_OBJECT,
        PROMPT_ONLY
    }

    @Override
    public AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel) {
        String model = (customModel != null && !customModel.isBlank()) ? customModel : defaultModel;
        
        System.out.println("Starting AI diagnostics using model: " + model);
        
        String systemPrompt = getSystemPrompt();
        String userPrompt = "이벤트 유형: " + eventType + "\n\n[분석할 데이터]\n" + logContent;

        List<Map<String, Object>> messages = new ArrayList<>();
        Map<String, Object> sysMsg = new HashMap<>();
        sysMsg.put("role", "system");
        sysMsg.put("content", systemPrompt);
        messages.add(sysMsg);

        Map<String, Object> userMsg = new HashMap<>();
        userMsg.put("role", "user");
        userMsg.put("content", userPrompt);
        messages.add(userMsg);

        String rawResultJson = null;
        boolean success = false;

        int fileCount = workspacePort.countSourceFiles(workspace);
        int maxIterations = Math.min(60, 15 + (fileCount / 30));
        System.out.println("[AI] Repo source file count: " + fileCount +
                " → dynamic agent loop cap: " + maxIterations + " iterations");

        // 3-Stage Layered Fallback Pipeline:
        // Step 1: STRUCTURED_SCHEMA (Strict Mode)
        // Step 2: JSON_OBJECT Mode (DeepSeek, Ollama, Groq, LocalAI, etc.)
        // Step 3: PROMPT_ONLY Mode (Markdown JSON output guide in prompt)
        List<ResponseMode> pipeline = Arrays.asList(ResponseMode.STRUCTURED_SCHEMA, ResponseMode.JSON_OBJECT, ResponseMode.PROMPT_ONLY);

        for (ResponseMode mode : pipeline) {
            System.out.println("[AI Pipeline] Attempting completion with mode: " + mode);
            try {
                List<Map<String, Object>> currentMessages = messages;
                if (mode == ResponseMode.PROMPT_ONLY) {
                    currentMessages = new ArrayList<>(messages);
                    currentMessages.get(0).put("content", getFallbackSystemPrompt(systemPrompt));
                }
                rawResultJson = runAgenticLoop(currentMessages, model, workspace, workspacePort, mode, maxIterations);
                if (rawResultJson != null && !rawResultJson.isBlank()) {
                    success = true;
                    break;
                }
            } catch (Exception e) {
                System.err.println("[AI Pipeline] Mode " + mode + " failed: " + e.getMessage());
                // Immediately proceed to next mode in pipeline on 400 Bad Request or parameter errors
            }
        }

        if (!success || rawResultJson == null) {
            return buildErrorResult("⚠️ AI 분석 호출 또는 데이터 파싱에 실패했습니다.");
        }

        return parseAnalysisResult(rawResultJson);
    }

    private String getFallbackSystemPrompt(String basePrompt) {
        return basePrompt + "\n반드시 다음 구조의 JSON 형식으로만 응답해 주십시오. (마크다운 ```json ... ``` 블록으로 감싸서 출력하세요).\n" +
                "{\n" +
                "  \"is_confident\": true/false,\n" +
                "  \"summary\": \"...\",\n" +
                "  \"impact\": \"...\",\n" +
                "  \"cause_description\": \"...\",\n" +
                "  \"pr_needed\": true/false,\n" +
                "  \"pr_candidates\": [\n" +
                "    {\n" +
                "      \"patch_summary\": \"...\",\n" +
                "      \"pr_title\": \"...\",\n" +
                "      \"pr_body\": \"...\",\n" +
                "      \"patch_instructions\": [\n" +
                "        {\n" +
                "          \"file_path\": \"...\",\n" +
                "          \"old_code\": \"...\",\n" +
                "          \"new_code\": \"...\"\n" +
                "        }\n" +
                "      ]\n" +
                "    }\n" +
                "  ]\n" +
                "}";
    }

    private String runAgenticLoop(List<Map<String, Object>> messages, String model, Path workspace, WorkspacePort workspacePort, ResponseMode mode, int maxIterations) throws Exception {
        Map<String, Integer> toolCallHistory = new HashMap<>();
        int iteration = 0;

        while (true) {
            iteration++;
            System.out.println(" -> Agentic Loop Iteration " + iteration + "/" + maxIterations + " [Mode: " + mode + "]");

            if (iteration > maxIterations) {
                throw new RuntimeException(
                        "[AI] Agentic loop exceeded dynamic cap of " + maxIterations +
                        " iterations (repo has ~" + workspacePort.countSourceFiles(workspace) + " source files)." +
                        " Review repo size thresholds."
                );
            }

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);
            requestBody.put("messages", messages);
            requestBody.put("temperature", 0.2);
            requestBody.put("tools", getToolsDefinitions());

            if (mode == ResponseMode.STRUCTURED_SCHEMA) {
                requestBody.put("response_format", getResponseSchema());
            } else if (mode == ResponseMode.JSON_OBJECT) {
                Map<String, String> jsonObjFormat = new HashMap<>();
                jsonObjFormat.put("type", "json_object");
                requestBody.put("response_format", jsonObjFormat);
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + getEffectiveApiKey());

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            String url = getEffectiveBaseUrl() + "/chat/completions";
            ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);

            if (response.getStatusCode() != HttpStatus.OK) {
                throw new RuntimeException("API Call failed: " + response.getStatusCode() + " - " + response.getBody());
            }

            JsonNode responseRoot = objectMapper.readTree(response.getBody());
            JsonNode choiceNode = responseRoot.path("choices").get(0);
            JsonNode messageNode = choiceNode.path("message");

            JsonNode toolCalls = messageNode.path("tool_calls");
            if (toolCalls.isArray() && toolCalls.size() > 0) {
                Map<String, Object> assistantMsg = new HashMap<>();
                assistantMsg.put("role", "assistant");
                
                List<Map<String, Object>> toolCallList = new ArrayList<>();
                for (JsonNode tc : toolCalls) {
                    Map<String, Object> tcMap = new HashMap<>();
                    tcMap.put("id", tc.path("id").asText());
                    tcMap.put("type", tc.path("type").asText());
                    
                    Map<String, Object> funcMap = new HashMap<>();
                    funcMap.put("name", tc.path("function").path("name").asText());
                    funcMap.put("arguments", tc.path("function").path("arguments").asText());
                    tcMap.put("function", funcMap);
                    
                    toolCallList.add(tcMap);
                }
                
                assistantMsg.put("tool_calls", toolCallList);
                if (!messageNode.path("content").isNull()) {
                    assistantMsg.put("content", messageNode.path("content").asText());
                }
                messages.add(assistantMsg);

                for (JsonNode toolCall : toolCalls) {
                    String callId = toolCall.path("id").asText();
                    String funcName = toolCall.path("function").path("name").asText();
                    String funcArgs = toolCall.path("function").path("arguments").asText();

                    String callKey = funcName + ":" + funcArgs;
                    toolCallHistory.put(callKey, toolCallHistory.getOrDefault(callKey, 0) + 1);

                    if (toolCallHistory.get(callKey) >= 5) {
                        throw new RuntimeException("Infinite loop detected: tool " + funcName + " was called repeatedly 5 times with args " + funcArgs);
                    }

                    System.out.println("   [Tool Call] " + funcName + " args: " + funcArgs);
                    JsonNode argsObj = objectMapper.readTree(funcArgs);
                    String result = "";

                    if ("list_directory".equals(funcName)) {
                        String dirPath = argsObj.path("directory_path").asText(".");
                        result = workspacePort.listDirectory(workspace, dirPath);
                    } else if ("read_file_content".equals(funcName)) {
                        String filePath = argsObj.path("file_path").asText();
                        result = workspacePort.readFile(workspace, filePath);
                    } else if ("grep_in_file".equals(funcName)) {
                        String filePath = argsObj.path("file_path").asText();
                        String query = argsObj.path("query").asText();
                        result = workspacePort.grepInFile(workspace, filePath, query);
                    } else {
                        result = "Error: Tool " + funcName + " is not recognized.";
                    }

                    Map<String, Object> toolResponse = new HashMap<>();
                    toolResponse.put("role", "tool");
                    toolResponse.put("tool_call_id", callId);
                    toolResponse.put("name", funcName);
                    toolResponse.put("content", result);
                    messages.add(toolResponse);
                }
            } else {
                return messageNode.path("content").asText();
            }
        }
    }

    private String sanitizeJsonString(String rawText) {
        if (rawText == null) return "";
        String jsonStr = rawText.trim();
        
        // Strip markdown code block wrapper if present (e.g. ```json ... ```)
        if (jsonStr.startsWith("```")) {
            int firstNewline = jsonStr.indexOf('\n');
            int lastBackticks = jsonStr.lastIndexOf("```");
            if (firstNewline != -1 && lastBackticks > firstNewline) {
                jsonStr = jsonStr.substring(firstNewline + 1, lastBackticks).trim();
            }
        }

        // Extract the outer-most JSON object if surrounded by extra conversational text
        if (!(jsonStr.startsWith("{") && jsonStr.endsWith("}"))) {
            int firstBrace = jsonStr.indexOf("{");
            int lastBrace = jsonStr.lastIndexOf("}");
            if (firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }
        }

        // Clean trailing commas before closing braces/brackets if present
        jsonStr = jsonStr.replaceAll(",\\s*([\\}\\],])", "$1");

        return jsonStr.trim();
    }

    private List<Map<String, Object>> getToolsDefinitions() {
        List<Map<String, Object>> tools = new ArrayList<>();

        Map<String, Object> t1 = new HashMap<>();
        t1.put("type", "function");
        Map<String, Object> f1 = new HashMap<>();
        f1.put("name", "list_directory");
        f1.put("description", "Lists subdirectories and files in a single-level folder path inside the project workspace.");
        Map<String, Object> p1 = new HashMap<>();
        p1.put("type", "object");
        Map<String, Object> prop1 = new HashMap<>();
        Map<String, Object> dirPathProp = new HashMap<>();
        dirPathProp.put("type", "string");
        dirPathProp.put("description", "Relative directory path from project root (e.g. '.', 'src', 'src/main/java'). Defaults to '.'.");
        prop1.put("directory_path", dirPathProp);
        p1.put("properties", prop1);
        f1.put("parameters", p1);
        t1.put("function", f1);
        tools.add(t1);

        Map<String, Object> t2 = new HashMap<>();
        t2.put("type", "function");
        Map<String, Object> f2 = new HashMap<>();
        f2.put("name", "read_file_content");
        f2.put("description", "Reads the source code content of a specific file in the workspace.");
        Map<String, Object> p2 = new HashMap<>();
        p2.put("type", "object");
        Map<String, Object> prop2 = new HashMap<>();
        Map<String, Object> filePathProp = new HashMap<>();
        filePathProp.put("type", "string");
        filePathProp.put("description", "Relative file path from project root (e.g. 'src/test/java/DemoApplicationTests.java').");
        prop2.put("file_path", filePathProp);
        p2.put("properties", prop2);
        p2.put("required", Arrays.asList("file_path"));
        f2.put("parameters", p2);
        t2.put("function", f2);
        tools.add(t2);

        Map<String, Object> t3 = new HashMap<>();
        t3.put("type", "function");
        Map<String, Object> f3 = new HashMap<>();
        f3.put("name", "grep_in_file");
        f3.put("description", "Searches for a specific query or symbol inside a single file to locate reference details.");
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
        f3.put("parameters", p3);
        t3.put("function", f3);
        tools.add(t3);

        return tools;
    }

    private Map<String, Object> getResponseSchema() {
        Map<String, Object> resFormat = new HashMap<>();
        resFormat.put("type", "json_schema");

        Map<String, Object> jsonSchema = new HashMap<>();
        jsonSchema.put("name", "error_analysis");
        jsonSchema.put("strict", true);

        Map<String, Object> schema = new HashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new HashMap<>();
        properties.put("is_confident", Map.of("type", "boolean"));
        properties.put("summary", Map.of("type", "string", "description", "에러 핵심 요약 (비개발자용)"));
        properties.put("impact", Map.of("type", "string", "description", "장애 전파 범위 및 영향도 (비개발자용)"));
        properties.put("cause_description", Map.of("type", "string", "description", "기술적 분석 및 수정 방안 (개발자 마크다운)"));
        properties.put("pr_needed", Map.of("type", "boolean"));

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
        patchItemProps.put("file_path", Map.of("type", "string"));
        patchItemProps.put("old_code", Map.of("type", "string"));
        patchItemProps.put("new_code", Map.of("type", "string"));
        patchItem.put("properties", patchItemProps);
        patchItem.put("required", Arrays.asList("file_path", "old_code", "new_code"));
        patchItem.put("additionalProperties", false);

        patchInstructions.put("items", patchItem);
        candidateProps.put("patch_instructions", patchInstructions);

        candidateItem.put("properties", candidateProps);
        candidateItem.put("required", Arrays.asList("patch_summary", "patch_instructions", "pr_title", "pr_body"));
        candidateItem.put("additionalProperties", false);

        prCandidates.put("items", candidateItem);
        properties.put("pr_candidates", prCandidates);

        schema.put("properties", properties);
        schema.put("required", Arrays.asList(
                "is_confident", "summary", "impact", "cause_description",
                "pr_needed", "pr_candidates"
        ));
        schema.put("additionalProperties", false);

        jsonSchema.put("schema", schema);
        resFormat.put("json_schema", jsonSchema);

        return resFormat;
    }

    private AiAnalysisResult buildErrorResult(String msg) {
        return new AiAnalysisResult(false, msg, "Error occurred during analysis", "", false, Collections.emptyList());
    }

    private String getSystemPrompt() {
        return "You are a senior DevOps and fullstack engineer. Analyze error logs and propose patches.\n" +
                "Use tools to explore directory and files.\n" +
                "Respond in Korean for all result fields (summary, impact, cause_description, patch_summary, pr_title, pr_body).\n" +
                "Propose up to 3 PR candidates.";
    }

    private AiAnalysisResult parseAnalysisResult(String rawResultJson) {
        try {
            String sanitized = sanitizeJsonString(rawResultJson);
            JsonNode root = objectMapper.readTree(sanitized);

            boolean isConfident = root.path("is_confident").asBoolean();
            String summary = root.path("summary").asText();
            String impact = root.path("impact").asText();
            String causeDescription = root.path("cause_description").asText();
            boolean prNeeded = root.path("pr_needed").asBoolean();

            List<PrCandidate> prCandidates = new ArrayList<>();
            JsonNode candidateNodes = root.path("pr_candidates");
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

        } catch (Exception e) {
            System.err.println("Failed to parse JSON: " + e.getMessage());
            return buildErrorResult("AI parsing failed: " + e.getMessage());
        }
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
        System.out.println("Starting OpenAI AI patch refinement using model: " + model);

        String systemPrompt = getSystemPrompt();
        List<Map<String, Object>> messages = new ArrayList<>();

        Map<String, Object> sysMsg = new HashMap<>();
        sysMsg.put("role", "system");
        sysMsg.put("content", systemPrompt);
        messages.add(sysMsg);

        Map<String, Object> userMsg1 = new HashMap<>();
        userMsg1.put("role", "user");
        userMsg1.put("content", "Event Type: " + eventType + "\n\nError Log:\n" + originalLogContent);
        messages.add(userMsg1);

        StringBuilder failedPatchDesc = new StringBuilder("Proposed patch that failed:\n");
        for (PatchInstruction patch : failedPatches) {
            failedPatchDesc.append("- File: ").append(patch.getFilePath()).append("\n");
            failedPatchDesc.append("  [Old Code]\n").append(patch.getOldCode()).append("\n");
            failedPatchDesc.append("  [New Code]\n").append(patch.getNewCode()).append("\n");
        }
        Map<String, Object> assistantMsg = new HashMap<>();
        assistantMsg.put("role", "assistant");
        assistantMsg.put("content", failedPatchDesc.toString());
        messages.add(assistantMsg);

        Map<String, Object> userMsg2 = new HashMap<>();
        userMsg2.put("role", "user");
        userMsg2.put("content", "The proposed patch failed the test harness.\n" +
                "Harness Output:\n\n" +
                "```\n" + harnessFailureLog + "\n```\n\n" +
                "Analyze the harness failure and failed patch, and propose a new refined patch.");
        messages.add(userMsg2);

        String rawResultJson = null;
        boolean success = false;

        int fileCount = workspacePort.countSourceFiles(workspace);
        int maxIterations = Math.min(60, 15 + (fileCount / 30));

        List<ResponseMode> pipeline = Arrays.asList(ResponseMode.STRUCTURED_SCHEMA, ResponseMode.JSON_OBJECT, ResponseMode.PROMPT_ONLY);

        for (ResponseMode mode : pipeline) {
            System.out.println("[AI Refinement Pipeline] Attempting completion with mode: " + mode);
            try {
                List<Map<String, Object>> currentMessages = messages;
                if (mode == ResponseMode.PROMPT_ONLY) {
                    currentMessages = new ArrayList<>(messages);
                    currentMessages.get(0).put("content", getFallbackSystemPrompt(systemPrompt));
                }
                rawResultJson = runAgenticLoop(currentMessages, model, workspace, workspacePort, mode, maxIterations);
                if (rawResultJson != null && !rawResultJson.isBlank()) {
                    success = true;
                    break;
                }
            } catch (Exception e) {
                System.err.println("[AI Refinement Pipeline] Mode " + mode + " failed: " + e.getMessage());
            }
        }

        if (!success || rawResultJson == null) {
            return buildErrorResult("AI refinement failed.");
        }

        return parseAnalysisResult(rawResultJson);
    }

    private String getEffectiveBaseUrl() {
        String envBaseUrl = System.getenv("PIKILAND_AI_BASE_URL");
        if (envBaseUrl != null && !envBaseUrl.isBlank()) {
            return envBaseUrl;
        }
        return (this.baseUrl != null && !this.baseUrl.isBlank()) ? this.baseUrl : "https://api.openai.com/v1";
    }

    private String getEffectiveApiKey() {
        String envKey = System.getenv("OPENAI_API_KEY");
        if (envKey != null && !envKey.isBlank()) {
            return envKey;
        }
        return this.apiKey;
    }
}
