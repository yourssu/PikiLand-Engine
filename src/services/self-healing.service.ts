import { SlackAdapter } from "../adapters/slack/slack.adapter";
import { AiAnalysisResult, CliConfig } from "../domain/models";
import { GithubAdapter } from "../adapters/github/github.adapter";
import { WorkspaceAdapter } from "../adapters/workspace/workspace.adapter";
import { AiAdapter } from "../adapters/ai/ai.adapter";
import { ProductionVerification } from "./production-verification";

export class SelfHealingService {
  private githubAdapter = new GithubAdapter();
  private workspaceAdapter = new WorkspaceAdapter();
  private aiAdapter = new AiAdapter();

  public async run(config:CliConfig):Promise<void> {
    if(config.eventType!=="production_log") throw new Error("Only production_log input is supported");
    if(!config.runId || !/^[a-f0-9]{64}$/.test(config.runId)) throw new Error("A production incident hash is required");
    const server=new URL(config.pikilandServerUrl || "https://pikiland.yourssu.com");
    if(server.protocol!=="https:" || server.username || server.password || server.search || server.hash || server.pathname!=="/") throw new Error("Verified HTTPS coordinator origin required");
    let outcome="FAILED";
    let summary:AiAnalysisResult|undefined;
    const prUrls:string[]=[];
    let issueUrl:string|null=null;
    try {
      const response=await fetch(`${server.origin}/api/settings/incidents/detail?hash=${config.runId}`,{
        headers:{Authorization:`Bearer ${config.token}`},redirect:"error",signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error(`Evidence fetch failed (${response.status})`);
      const text=await response.text();
      if(Buffer.byteLength(text)>65536) throw new Error("Evidence bundle too large");
      const detail=JSON.parse(text) as {repositoryFullName?:string;rawLog?:string};
      if(detail.repositoryFullName!==config.repoName || !detail.rawLog) throw new Error("Evidence repository mismatch or missing evidence");
      const evidence=this.workspaceAdapter.redactSecrets(detail.rawLog);
      let ruleId="explicit_error", service="legacy", route="all";
      try {
        const bundle=JSON.parse(evidence);
        if(bundle.source!=="production_log" || bundle.repository!==config.repoName || bundle.incidentId!==config.runId || bundle.schemaVersion!==1 || !bundle.observation?.quality?.complete) {
          outcome="NEEDS_EVIDENCE";return;
        }
        ruleId=bundle.observation.ruleId;
        service=bundle.observation.service;route=bundle.observation.route;
      } catch { /* legacy redacted production errors still require an explicit_error policy */ }
      const diagnosis=await this.aiAdapter.diagnose(config,evidence,config.workspacePath);
      summary=diagnosis;
      if(!diagnosis.prNeeded) {
        if(diagnosis.issueNeeded && diagnosis.issueTitle && diagnosis.issueBody) {
          issueUrl=await this.githubAdapter.createIssue(config.repoName,this.workspaceAdapter.redactSecrets(diagnosis.issueTitle),this.workspaceAdapter.redactSecrets(diagnosis.issueBody),config.token);
        }
        outcome="NO_PR";return;
      }
      const gate=new ProductionVerification(config.workspacePath,this.workspaceAdapter);
      const policy=await gate.load(ruleId,service,route);
      if(!policy) {outcome="NEEDS_EVIDENCE";return;}
      const red=await gate.reproduce(policy);
      if(!red.reproduced) {outcome="NEEDS_EVIDENCE";return;}
      const patchConfig={...config,allowedSourcePaths:policy.allowedSourcePaths,protectedPaths:policy.protectedPaths};
      const context=`${evidence}\nConfirmed expected behavior: ${policy.expectedBehavior}\nReproduced failure: ${red.output}`;
      let result=await this.aiAdapter.analyzeError(patchConfig,context,config.workspacePath);
      if(!result.prNeeded) {outcome="NO_PR";return;}
      let verified=await gate.verify(policy);
      for(let retry=0;!verified.success && retry<Math.min(config.maxRetries,3);retry++) {
        result=await this.aiAdapter.refinePatch(patchConfig,context,config.workspacePath,verified.output);
        if(!result.prNeeded) break;
        verified=await gate.verify(policy);
      }
      if(!verified.success || !result.prNeeded) {outcome="NEEDS_EVIDENCE";return;}
      await gate.assertScope(policy);
      const changedFiles=await gate.changedFiles();
      if(!changedFiles.length) {outcome="NO_PR";return;}
      const branch=`pikiland/fix-${config.runId}`;
      const existing=await this.githubAdapter.findOpenPullRequest(config.repoName,branch,config.token);
      if(existing) {prUrls.push(existing);outcome="PR_CREATED";return;}
      const title=result.prTitle || "fix: verified production behavior";
      await this.workspaceAdapter.commitAndPush(config.workspacePath,branch,title,config.token,config.repoName,config.gitUserName,config.gitUserEmail,changedFiles);
      const body=this.workspaceAdapter.redactSecrets(`${result.prBody || ""}\n\nVerification: incident-specific reproduction failed before the patch and passed after; regression command passed.\nExpected behavior: ${policy.expectedBehavior}\n\nPikiLand Incident Fingerprint: ${config.runId}`);
      const prUrl=await this.githubAdapter.createPullRequest(config.repoName,title,body,branch,config.targetBranch || "main",config.token);
      if(!prUrl) throw new Error("Verified patch publication returned no PR");
      prUrls.push(prUrl);
      outcome="PR_CREATED";
    } finally {
      // Job result updates never create new incidents. Failed reporting fails the run.
      const result=await fetch(`${server.origin}/api/production/incidents/${config.runId}/result`,{
        method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"},body:JSON.stringify({outcome}),redirect:"error",signal:AbortSignal.timeout(10000)});
      if(!result.ok) throw new Error(`Incident result reporting failed (${result.status})`);
      if(config.slackWebhookUrl && summary) {
        await new SlackAdapter().sendNotification(config.slackWebhookUrl, "", {...summary,
          prNeeded:outcome==="PR_CREATED", prNotNeededReason:outcome==="PR_CREATED"?null:`Production verification outcome: ${outcome}`},
          "production_log",config.repoName,config.runId,prUrls,issueUrl);
      }
      console.log(`Production incident ${config.runId}: ${outcome}`);
    }
  }
}
