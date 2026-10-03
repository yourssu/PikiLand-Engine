import {afterEach,beforeEach,describe,expect,it} from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {simpleGit} from "simple-git";
import {ProductionVerification,sourceAllowed} from "./production-verification";
import {WorkspaceAdapter} from "../adapters/workspace/workspace.adapter";
let dir:string;
const policy={version:1,service:"nginx",route:"all",ruleIds:["response_contract"],expectedBehavior:"The fixture response must contain the expected value",reproductionCommand:"reproduce",regressionCommand:"regression",failureMarker:"EXPECTED_RESPONSE_MISSING",failureExitCode:1,allowedSourcePaths:["src"],protectedPaths:["tests"]};
beforeEach(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),"production-gate-"));
  for(const folder of ["src","tests",".pikiland"])await fs.mkdir(path.join(dir,folder));
  await fs.writeFile(path.join(dir,"src/app.ts"),"bad");
  await fs.writeFile(path.join(dir,"tests/app.test.ts"),"assert original expectation");
  await fs.writeFile(path.join(dir,".pikiland/production-verification.json"),JSON.stringify(policy));
  const git=simpleGit(dir);await git.init();await git.addConfig("user.email","test@example.invalid");await git.addConfig("user.name","Test");await git.add(".");await git.commit("fixture");
});
afterEach(async()=>{await fs.rm(dir,{recursive:true,force:true});});
function adapter(results:any[]):WorkspaceAdapter{const a=new WorkspaceAdapter();a.runHarness=async()=>results.shift();return a;}
describe("production verification gates",()=>{
  it("requires an approved incident-specific policy",async()=>{
    expect(await new ProductionVerification(dir).load("unrelated","nginx","all")).toBeNull();
    expect(await new ProductionVerification(dir).load("response_contract","other-service","all")).toBeNull();
    await fs.rm(path.join(dir,".pikiland/production-verification.json"));
    await expect(new ProductionVerification(dir).load("response_contract","nginx","all")).rejects.toThrow("clean checkout");
  });
  it("requires failure exit code AND the registered assertion marker",async()=>{
    const gate=new ProductionVerification(dir,adapter([{success:false,exitCode:1,output:"compiler failed"},{success:true,exitCode:0,output:policy.failureMarker},{success:false,exitCode:1,output:policy.failureMarker}]));
    const approved=(await gate.load("response_contract","nginx","all"))!;
    expect((await gate.reproduce(approved)).reproduced).toBe(false);
    expect((await gate.reproduce(approved)).reproduced).toBe(false);
    expect((await gate.reproduce(approved)).reproduced).toBe(true);
  });
  it("requires both reproduction and regression to pass",async()=>{
    const gate=new ProductionVerification(dir,adapter([{success:true,exitCode:0,output:"ok"},{success:false,exitCode:1,output:"regression"}]));
    const approved=(await gate.load("response_contract","nginx","all"))!;
    expect((await gate.verify(approved)).success).toBe(false);
  });
  it("rejects changed tests even if the harness passes",async()=>{
    const gate=new ProductionVerification(dir);const approved=(await gate.load("response_contract","nginx","all"))!;
    await fs.writeFile(path.join(dir,"tests/app.test.ts"),"always pass");
    await expect(gate.assertScope(approved)).rejects.toThrow("Protected");
  });
  it("allows source fix but rejects added tests, policy or dependencies",async()=>{
    const gate=new ProductionVerification(dir);const approved=(await gate.load("response_contract","nginx","all"))!;
    await fs.writeFile(path.join(dir,"src/app.ts"),"fixed");await gate.assertScope(approved);
    await fs.writeFile(path.join(dir,"package.json"),"{}");await expect(gate.assertScope(approved)).rejects.toThrow("scope");
    expect(sourceAllowed("src/app.test.ts",approved)).toBe(false);
    expect(sourceAllowed("src/../tests/x",approved)).toBe(false);
  });
});
