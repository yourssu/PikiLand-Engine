import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  AiAnalysisResult,
  AiAnalysisResultSchema,
  CliConfig,
  PatchInstruction
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
모든 응답 필드('summary', 'impact', 'causeDescription', 'patchSummary', 'prTitle', 'prBody')는 반드시 **한국어**로만 작성하십시오.

📢 [Slack 알림 용 - 비개발자 대상 필드 규칙]
1. 'summary', 'impact', 'patchSummary' 필드는 기획자, PM, 운영팀 등 **비개발자**를 대상으로 합니다.
2. 개발/IT 전문 용어를 최대한 배제하거나 한글로 아주 쉽게 풀어서 설명해 주십시오.
3. 객관적이고 단순 명료하게 비개발자가 시스템 장애 현상과 고쳐진 방향을 한눈에 파악할 수 있게 하십시오.

💻 [GitHub PR 용 - 개발자 대상 필드 규칙]
1. 각 PR 후보 내의 'prTitle', 'prBody', 'causeDescription'은 코드 검토를 진행할 **개발자**들을 대상으로 합니다.
2. 에러의 기술적 원인, 스택 트레이스 상의 문제 지점, 수정사항의 기술적 타당성, 사이드 이펙트(부작용) 가능성 등을 개발자 전문 용어를 적극 사용하여 상세히 서술하십시오.
3. 필요 시 수정 코드 스니펫이나 원본 로그 스니펫을 PR 본문에 마크다운으로 포함시켜 개발자가 바로 검토할 수 있게 하십시오.

🤖 [중요 - PR 후보군(Candidates) 생성 규칙]
에러를 해결하기 위해 최대 3개의 서로 다른 PR 수정 후보(1개 ~ 3개)를 생성하십시오. 각 후보는 서로 다른 접근 방식이거나, 가장 유력한 시도들이어야 합니다. 해결책에 확신이 부족하더라도 사람이 검토할 수 있도록 가능한 한 PR 후보들을 구체적으로 제안하여 'prCandidates' 배열에 담아 주십시오.

⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]
1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열("test")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.
2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.
3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.
4. **해결책의 불명확성 인지**: 로그나 정보가 부족하여 완전하고 근본적인 해결 코드를 제어할 수 없거나, 소스 코드 수정만으로는 불가능한 환경/인프라성 장애인 경우, 절대로 'prNeeded'를 false로 지정하십시오.

📂 [중요 - 다중 파일 및 oldCode 패치 정확도 규칙]
1. 오류나 기능 결함이 여러 소스 파일에 걸쳐 발생하는 경우, 'patchInstructions' 배열에 관련된 모든 파일의 수정 지시문을 동시에 포함시켜 제안하십시오.
2. **'oldCode' 작성 시 원본 100% 일치 필수**: 'oldCode'는 추측하거나 축약(...)하지 말고, 반드시 제공된 'readFileContent' 도구를 통해 원본 소스 파일을 직접 읽은 후 교체하고자 하는 원본 코드 블록을 줄바꿈, 공백, 주석까지 **토씨 하나 틀리지 않고 100% 그대로 복사**하여 지정하십시오. 원본 코드와 일치하지 않으면 패치 적용에 실패합니다.`;

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
    previousPatches: PatchInstruction[],
    harnessFailureOutput: string
  ): Promise<AiAnalysisResult> {
    const userPrompt = `PikiLand AI Self-Healing Engine (Ralph Loop Refinement).
제안했던 패치를 적용하고 테스트 하네스(Harness)를 실행했으나 실패했습니다.

Target Workspace Directory: ${workspacePath}

[Original Error Log]
${logContent}

[Previous Applied Patches]
${JSON.stringify(previousPatches, null, 2)}

[Harness Post-Patch Failure Output]
${harnessFailureOutput}

Instructions:
1. 테스트 실패 원인과 제안했던 패치 코드를 다시 분석하여, 이를 수정한 새로운 보완 패치(refinement patch)를 제안해 주십시오.
2. 필요하다면 제공된 파일 탐색 도구를 사용하여 실패 원인을 정밀 분석하십시오.
3. 만약 기존 파일 수정 내역이 유효하다면 이를 보존하고, 보완된 수정을 포함한 전체 관련 파일 패치 목록을 'patchInstructions' 배열에 종합하여 제출하십시오.`;

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
        console.error("[AiAdapter] Fallback direct call also failed:", fallbackErr);
        return {
          isConfident: false,
          summary: `⚠️ AI 분석 호출에 실패했습니다. 에러: ${(fallbackErr as Error).message || fallbackErr}`,
          impact: "오류가 발생하여 장애 영향을 분석하지 못했습니다.",
          causeDescription: "AI 연동 중 예외가 발생했습니다.",
          prNeeded: false,
          prCandidates: [],
        };
      }
    }
  }
}
