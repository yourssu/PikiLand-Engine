import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  AiAnalysisResult,
  AiAnalysisResultSchema,
  CliConfig,
} from "../../domain/models";
import { WorkspaceAdapter } from "../workspace/workspace.adapter";
import {
  createOpencodeReadTool,
  createOpencodeEditTool,
  createOpencodeWriteTool,
  createOpencodeListTool,
  createOpencodeGrepTool,
} from "../../tools/opencode/opencode.tools";

const KOREAN_SYSTEM_PROMPT = `당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.

당신은 오류의 맥락을 정확히 이해하고 소스코드를 직접 수정하기 위해 프로젝트 워크스페이스 도구(read, edit, write, list, grep)를 적극 활용할 수 있습니다.

🌐 [언어 규칙]
모든 응답 필드('summary', 'impact', 'causeDescription', 'prTitle', 'prBody', 'prNotNeededReason', 'issueTitle', 'issueBody')는 반드시 **한국어**로만 작성하십시오.

📢 [Slack 알림 용 - 비개발자 대상 필드 규칙 (매우 엄격 적용)]
1. **'summary' 및 'impact' 필드는 소프트웨어/코딩 지식이 전혀 없는 완전한 비개발자(기획자, PM, 서비스 대표, 운영진)**를 핵심 대상으로 합니다.
2. **개발/IT 전문 용어 및 코드 요소 100% 사용 금지**:
   - 변수명, 함수명, 파일 경로, 클래스명, DB 테이블명, HTTP 에러 코드(500, 404 등), 예외 이름(NullPointer, StackTrace, Exception 등), 기술 전문 용어(Refactoring, Async, Deploy 등)를 절대 직접 사용하지 마십시오.
3. **일상 언어와 사용자 경험/서비스 영향 위주의 쉬운 표현**:
   - ❌ 잘못된 작성: "UserService.java 42번 줄에서 NullPointerException 발생으로 인한 500 Server Error"
   - ⭕ 올바른 작성: "사용자가 마이페이지에서 회원 정보 수정 버튼을 눌렀을 때 내용이 저장되지 않고 오류 화면이 출력되는 현상입니다."
4. 기술적인 정확한 예외 원인, 스택 트레이스, 관련 소스 코드 파일 위치는 개발자 전용 필드인 'causeDescription' 및 'prBody'에만 상세히 서술하십시오.

💻 [GitHub PR 용 - 개발자 대상 필드 규칙]
1. 'prTitle', 'prBody', 'causeDescription'은 코드 검토를 진행할 **개발자**들을 대상으로 합니다.
2. 에러의 기술적 원인, 스택 트레이스 상의 문제 지점, 수정사항의 기술적 타당성, 사이드 이펙트(부작용) 가능성 등을 개발자 전문 용어를 적극 사용하여 상세히 서술하십시오.
3. 필요 시 수정 코드 스니펫이나 원본 로그 스니펫을 PR 본문에 마크다운으로 포함시켜 개발자가 바로 검토할 수 있게 하십시오.

🎯 [중요 - PR 생성 판정 규칙 (prNeeded)]
- **'prNeeded = true' 조건**: **오류의 발생 원인(Root Cause)과 소스 코드 수준의 해결 방법(Fix Path)이 100% 명확하고 확실할 때만** 'prNeeded: true'로 설정하고 'prTitle' 및 'prBody'를 작성하여 PR을 생성하십시오.
- 원인이나 해결책 중 하나라도 불확실하거나 추측에 의존해야 하는 상황이라면 성급하게 PR을 생성하지 말고 'prNeeded: false'로 지정하십시오.

⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]
1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열("test")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.
2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.
3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.

📋 [중요 - prNeeded = false 인 경우의 이유 작성 및 GitHub Issue 생성 규칙]
1. **prNeeded = true 인 경우**: 'issueNeeded', 'issueTitle', 'issueBody', 'prNotNeededReason' 필드는 모두 null로 설정하십시오.
2. **prNeeded = false 인 경우**:
   - 'prNotNeededReason' 필드에 PR을 자동으로 생성하지 못한 구체적 이유(예: "원인 분석 결과 개발팀의 정책적 의사결정 필요", "DB 권한 및 인프라 설정 변경 필요")를 명확히 서술하십시오.
   - **'issueNeeded = true' 조건**: AI 자신이 코드 수정이나 PR 생성을 직접 완결할 수는 없지만(예: 인프라 권한 설정 변경, 외부 API 연동 변경, 개발팀의 정책적 의사결정 필요 등), **어떻게 해결해야 하는지 명확한 해결 방법과 대응 지침이 확실할 때만** 'issueNeeded: true'로 설정하여 GitHub Issue를 작성하십시오.
   - 해결법조차 불확실하거나 단순 일회성 노이즈 로그이거나 원인을 파악할 수 없는 경우에는 'issueNeeded: false'로 설정하고 'issueTitle', 'issueBody'는 null로 지정하십시오.`;

export class AiAdapter {
  private workspaceAdapter: WorkspaceAdapter;

  constructor() {
    this.workspaceAdapter = new WorkspaceAdapter();
  }

  public async analyzeError(
    config: CliConfig,
    logContent: string,
    workspacePath: string
  ): Promise<AiAnalysisResult> {
    const userPrompt = `이벤트 유형: ${config.eventType}\nTarget Repository: ${config.repoName}\nTarget Workspace Directory: ${workspacePath}\n\n[분석할 데이터 / 에러 로그]\n${logContent}`;

    return await this.runAgenticAnalysis(config, userPrompt, workspacePath);
  }

  public async refinePatch(
    config: CliConfig,
    logContent: string,
    workspacePath: string,
    harnessFailureOutput: string
  ): Promise<AiAnalysisResult> {
    const userPrompt = `PikiLand AI Self-Healing Engine (Ralph Loop Refinement).
제공된 파일 도구(edit, write)로 수정한 코드를 적용하고 테스트 하네스(Harness)를 실행했으나 아래와 같이 실패했습니다.

Target Workspace Directory: ${workspacePath}

[Original Error Log]
${logContent}

[Harness Post-Patch Failure Output]
${harnessFailureOutput}

Instructions:
1. 테스트 실패 원인과 소스 코드를 재분석하여, OpenCode 파일 도구(read, edit, write)로 워크스페이스 코드를 올바르게 보완 수정하십시오.
2. 보완 완료 후 최종 결과를 요약하여 제출하십시오.`;

    return await this.runAgenticAnalysis(config, userPrompt, workspacePath);
  }

  private getModel(config: CliConfig) {
    const customBaseUrl = config.customBaseUrl;
    const modelName = config.customModel || "gpt-4o";

    if (config.anthropicApiKey || modelName.toLowerCase().includes("claude")) {
      const anthropic = createAnthropic({
        apiKey: config.anthropicApiKey || "placeholder-key",
        baseURL: customBaseUrl,
      });
      return anthropic(modelName);
    } else {
      const openai = createOpenAI({
        apiKey: config.openAiApiKey || "placeholder-key",
        baseURL: customBaseUrl,
      });
      return openai(modelName);
    }
  }

  private async runAgenticAnalysis(
    config: CliConfig,
    prompt: string,
    workspacePath: string
  ): Promise<AiAnalysisResult> {
    const modelProvider = this.getModel(config);

    const tools = {
      read: createOpencodeReadTool(this.workspaceAdapter, workspacePath),
      edit: createOpencodeEditTool(this.workspaceAdapter, workspacePath),
      write: createOpencodeWriteTool(this.workspaceAdapter, workspacePath),
      list: createOpencodeListTool(this.workspaceAdapter, workspacePath),
      grep: createOpencodeGrepTool(this.workspaceAdapter, workspacePath),
    };

    try {
      const fileCount = await this.workspaceAdapter.countSourceFiles(workspacePath);
      const maxSteps = Math.min(60, 15 + Math.floor(fileCount / 30));
      console.log(`[AI Adapter] Dynamic maxSteps cap calculated: ${maxSteps} (for ~${fileCount} workspace files)`);
      console.log(`[AI Adapter] Starting agentic investigation loop...`);

      // Step 1: Agentic loop with tools to gather context & modify code with 3-min timeout guard
      const { text: agenticContext } = await generateText({
        model: modelProvider,
        system: KOREAN_SYSTEM_PROMPT,
        prompt,
        tools,
        maxSteps,
        abortSignal: AbortSignal.timeout(180000),
      });

      console.log(`[AI Adapter] Agentic loop completed. Generating structured output...`);

      // Step 2: Generate final structured analysis result based on gathered context
      const structuredPrompt = `${prompt}\n\n[Agent Investigation Findings & Context]\n${agenticContext}`;
      const { object } = await generateObject({
        model: modelProvider,
        schema: AiAnalysisResultSchema,
        system: KOREAN_SYSTEM_PROMPT,
        prompt: structuredPrompt,
        abortSignal: AbortSignal.timeout(180000),
      });

      return object;
    } catch (error) {
      console.error("[AiAdapter] Agentic analysis error, falling back to direct generateObject:", error);
      try {
        const { object } = await generateObject({
          model: modelProvider,
          schema: AiAnalysisResultSchema,
          system: KOREAN_SYSTEM_PROMPT,
          prompt,
        });
        return object;
      } catch (fallbackErr) {
        const err = fallbackErr as Error;
        console.error("[AiAdapter] Fallback direct call also failed:", err);
        throw new Error(`AI LLM Analysis API call failed: ${err.message || err}`);
      }
    }
  }
}
