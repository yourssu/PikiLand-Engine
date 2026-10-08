import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { WorkspaceAdapter } from "../adapters/workspace/workspace.adapter";

const relative = z.string().min(1).max(256).refine(p=>!p.startsWith("/") && !p.split(/[\\/]/).some(s=>s===".." || s.startsWith(".")));
export const VerificationPolicySchema = z.object({
  version:z.literal(1),
  service:z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/),
  route:z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/),
  ruleIds:z.array(z.string().min(1)).min(1),
  expectedBehavior:z.string().min(10).max(4000),
  reproductionCommand:z.string().min(1).max(1000),
  regressionCommand:z.string().min(1).max(1000),
  failureMarker:z.string().min(5).max(500),
  failureExitCode:z.number().int().min(1).max(125),
  allowedSourcePaths:z.array(relative).min(1).max(20),
  protectedPaths:z.array(relative).min(1).max(100),
}).strict();
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;

export function sourceAllowed(file: string, policy: Pick<VerificationPolicy,"allowedSourcePaths"|"protectedPaths">): boolean {
  if (!file || path.isAbsolute(file) || file.includes("\\") || file.split("/").some(p=>p===".." || p.startsWith("."))) return false;
  if (/(^|\/)(tests?|__tests__|fixtures?|node_modules|pikiland-engine)(\/|$)|\.(test|spec)\.|(^|\/)(package[^/]*\.json|[^/]*lock[^/]*|AGENTS\.md|AI\.md)$/i.test(file)) return false;
  if (policy.protectedPaths.some(p=>file===p || file.startsWith(p.replace(/\/$/,"")+"/"))) return false;
  return policy.allowedSourcePaths.some(p=>file===p || file.startsWith(p.replace(/\/$/,"")+"/"));
}

export class ProductionVerification {
  private protectedHashes = new Map<string,string>();
  constructor(private workspace:string, private adapter = new WorkspaceAdapter()) {}

  async load(ruleId:string, service:string, route:string):Promise<VerificationPolicy|null> {
    const git = simpleGit(this.workspace);
    const status = await git.status();
    if (status.files.some(f=>!f.path.startsWith("pikiland-engine/"))) throw new Error("Verification requires a clean checkout");
    let policy:VerificationPolicy;
    try { if ((await fs.lstat(path.join(this.workspace,".pikiland/production-verification.json"))).isSymbolicLink()) return null;
      policy=VerificationPolicySchema.parse(JSON.parse(await fs.readFile(path.join(this.workspace,".pikiland/production-verification.json"),"utf8"))); }
    catch { return null; }
    if (!policy.ruleIds.includes(ruleId) || policy.service !== service || policy.route !== route) return null;
    // The policy must be tracked and provided by maintainers, never generated from logs.
    const tracked = (await git.raw(["ls-files","-z"])).split("\0").filter(Boolean);
    if (!tracked.includes(".pikiland/production-verification.json")) return null;
    for (const entry of policy.protectedPaths) {
      if (!tracked.some(f=>f===entry || f.startsWith(entry.replace(/\/$/,"")+"/"))) return null;
    }
    for(const file of tracked) {
      if (!sourceAllowed(file,policy)) this.protectedHashes.set(file,await this.hash(file));
    }
    return policy;
  }

  private async hash(file:string):Promise<string> {
    const full=path.join(this.workspace,file);
    const stat=await fs.lstat(full);
    const value=stat.isSymbolicLink()?await fs.readlink(full):await fs.readFile(full);
    return createHash("sha256").update(value).update(String(stat.mode)).digest("hex");
  }

  async changedFiles():Promise<string[]> {
    const git=simpleGit(this.workspace);
    const changed=(await git.raw(["diff","--name-only","-z","HEAD"])).split("\0");
    const added=(await git.raw(["ls-files","--others","--exclude-standard","-z"])).split("\0");
    return [...new Set([...changed,...added].filter(f=>Boolean(f) && !f.startsWith("pikiland-engine/")))];
  }

  async assertScope(policy:VerificationPolicy):Promise<void> {
    for(const [file,hash] of this.protectedHashes) {
      if(await this.hash(file)!==hash) throw new Error(`Protected verification file changed: ${file}`);
    }
    for(const file of await this.changedFiles()) {
      if(file.startsWith("pikiland-engine/")) continue;
      if(!sourceAllowed(file,policy)) throw new Error(`Patch outside allowed source scope: ${file}`);
      const full=path.join(this.workspace,file);
      const st=await fs.lstat(full).catch(()=>null);
      if(st?.isSymbolicLink()) throw new Error("Symlink patches are not permitted");
    }
  }

  async reproduce(policy:VerificationPolicy):Promise<{reproduced:boolean;output:string}> {
    const result=await this.adapter.runHarness(this.workspace,policy.reproductionCommand);
    await this.assertScope(policy);
    return {reproduced:!result.success && !result.executionError && result.exitCode===policy.failureExitCode && result.output.includes(policy.failureMarker),output:result.output};
  }

  async verify(policy:VerificationPolicy):Promise<{success:boolean;output:string}> {
    await this.assertScope(policy);
    const repro=await this.adapter.runHarness(this.workspace,policy.reproductionCommand);
    if(!repro.success) return repro;
    const regression=await this.adapter.runHarness(this.workspace,policy.regressionCommand);
    await this.assertScope(policy);
    return regression;
  }
}
