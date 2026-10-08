import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it,spyOn} from "bun:test";
import {SelfHealingService} from "./self-healing.service";
import {CliConfig} from "../domain/models";
const config={eventType:"production_log",runId:"a".repeat(64),repoName:"owner/repo",token:"fake",workspacePath:"/tmp",logContent:"",maxRetries:1,pikilandServerUrl:"https://example.invalid"} as CliConfig;
describe("production-only engine",()=>{
  it("rejects workflow and issue inputs before IO",async()=>{
    for(const eventType of ["workflow_run","issues"])await expect(new SelfHealingService().run({...config,eventType})).rejects.toThrow("Only production_log");
  });
  it("rejects insecure coordinator origins",async()=>{
    for(const url of ["http://example.com","https://user:pass@example.com","https://example.com/path"])await expect(new SelfHealingService().run({...config,pikilandServerUrl:url})).rejects.toThrow("HTTPS");
  });
  it("rejects cross-repository evidence and reports failure",async()=>{
    const requests:string[]=[];
    const fetch=spyOn(globalThis,"fetch").mockImplementation((async(input: RequestInfo | URL,init?: RequestInit)=>{
      requests.push(String(input));
      if(init?.method==="POST"){expect(JSON.parse(String(init.body)).outcome).toBe("FAILED");return new Response("{}");}
      return new Response(JSON.stringify({repositoryFullName:"another/repo",rawLog:"ERROR"}));
    }) as typeof globalThis.fetch);
    try{await expect(new SelfHealingService().run(config)).rejects.toThrow("repository mismatch");expect(requests).toHaveLength(2);}finally{fetch.mockRestore();}
  });
  it("does not analyze incomplete evidence",async()=>{
    const service=new SelfHealingService();
    const diagnosis=spyOn((service as any).aiAdapter,"diagnose");
    const fetch=spyOn(globalThis,"fetch").mockImplementation((async(_input: RequestInfo | URL,init?: RequestInit)=>{
      if(init?.method==="POST"){expect(JSON.parse(String(init.body)).outcome).toBe("NEEDS_EVIDENCE");return new Response("{}");}
      return new Response(JSON.stringify({repositoryFullName:config.repoName,rawLog:JSON.stringify({schemaVersion:1,source:"production_log",repository:config.repoName,incidentId:config.runId,observation:{quality:{complete:false}}})}));
    }) as typeof globalThis.fetch);
    try{await service.run(config);expect(diagnosis).not.toHaveBeenCalled();}finally{fetch.mockRestore();diagnosis.mockRestore();}
  });
});

describe("optional repository instructions",()=>{
  for(const prNeeded of [false,true]) it(`diagnoses without instruction files (prNeeded=${prNeeded})`,async()=>{
    const workspacePath=await mkdtemp(join(tmpdir(),"pikiland-instructions-"));
    const service=new SelfHealingService();
    const diagnosis=spyOn((service as any).aiAdapter,"diagnose").mockResolvedValue({prNeeded,issueNeeded:false});
    const patch=spyOn((service as any).aiAdapter,"analyzeError");
    const {ProductionVerification}=await import("./production-verification");
    const gate=spyOn(ProductionVerification.prototype,"load").mockResolvedValue(null);
    const outcomes:string[]=[];
    const fetch=spyOn(globalThis,"fetch").mockImplementation((async(_input: RequestInfo | URL,init?: RequestInit)=>{
      if(init?.method==="POST"){outcomes.push(JSON.parse(String(init.body)).outcome);return new Response("{}");}
      return new Response(JSON.stringify({repositoryFullName:config.repoName,rawLog:JSON.stringify({schemaVersion:1,source:"production_log",repository:config.repoName,incidentId:config.runId,observation:{quality:{complete:true},ruleId:"http_5xx",service:"web",route:"all"}})}));
    }) as typeof globalThis.fetch);
    try {
      await service.run({...config,workspacePath});
      expect(diagnosis).toHaveBeenCalledTimes(1);
      expect(outcomes).toEqual([prNeeded?"NEEDS_EVIDENCE":"NO_PR"]);
      expect(gate).toHaveBeenCalledTimes(prNeeded?1:0);
      expect(patch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();diagnosis.mockRestore();patch.mockRestore();gate.mockRestore();
      await rm(workspacePath,{recursive:true,force:true});
    }
  });
});
