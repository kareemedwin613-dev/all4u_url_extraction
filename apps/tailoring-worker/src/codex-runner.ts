import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { TailoringInput, TailoringOutput, TailoringPreview } from "./types.js";
import { buildTailoringPrompt, tailoringModelContext, tailoringRoleTargets } from "./prompt.js";
import{MAX_TAILORED_SKILLS,reconcileSkillGroups}from"./skill-groups.js";
import { enforceGenerationContract, validateTailoringInput, validateTailoringModelOutput } from "./validation.js";

const moduleDirectory=dirname(fileURLToPath(import.meta.url));
export const OUTPUT_SCHEMA_PATH=resolve(moduleDirectory,"../schemas/tailoring-output.schema.json");
const MAX_LOG_BYTES=1024*1024;

export interface CodexExecutionRequest { workspace:string;prompt:string;schemaPath:string;outputPath:string;timeoutMs:number; }
export interface CodexExecutionResult { stdout:string;stderr:string; }
export type CodexExecutor=(request:CodexExecutionRequest)=>Promise<CodexExecutionResult>;

function codexEnvironment(){
  const allowed=["PATH","Path","PATHEXT","SystemRoot","WINDIR","COMSPEC","TEMP","TMP","TMPDIR","USERPROFILE","HOME","CODEX_HOME","LANG","LC_ALL"];
  return Object.fromEntries(allowed.flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key] as string]]));
}

export interface CodexInvocation{command:string;prefixArgs:string[];}
export function resolveCodexInvocation(requested=process.env.TAILORING_CODEX_BIN||"codex",platform=process.platform,environment:NodeJS.ProcessEnv=process.env,exists:(path:string)=>boolean=existsSync):CodexInvocation{
  const executable=requested.trim()||"codex";
  if(platform!=="win32")return{command:executable,prefixArgs:[]};
  const npmWrapper=(commandPath:string):CodexInvocation|null=>{const script=win32.resolve(win32.dirname(commandPath),"node_modules","@openai","codex","bin","codex.js");return exists(script)?{command:process.execPath,prefixArgs:[script]}:null;};
  if(/[\\/]/.test(executable)){
    const absolute=win32.resolve(executable);
    if(/\.cmd$/i.test(absolute))return npmWrapper(absolute)||{command:absolute,prefixArgs:[]};
    return{command:absolute,prefixArgs:[]};
  }
  const searchPath=environment.Path||environment.PATH||"",separator=platform==="win32"?";":delimiter;
  for(const directory of searchPath.split(separator).map(value=>value.trim().replace(/^"|"$/g,"")).filter(Boolean)){
    const native=win32.join(directory,executable.replace(/\.exe$/i,"")+".exe");if(exists(native))return{command:native,prefixArgs:[]};
    const command=win32.join(directory,executable.replace(/\.cmd$/i,"")+".cmd");if(exists(command)){const wrapper=npmWrapper(command);if(wrapper)return wrapper;}
  }
  return{command:executable,prefixArgs:[]};
}

const REASONING_EFFORTS=new Set(["none","low","medium","high","xhigh"]);
export function codexPerformanceArgs(environment:NodeJS.ProcessEnv=process.env){
  const model=String(environment.TAILORING_CODEX_MODEL||"gpt-5.6-sol").trim();
  if(!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(model))throw new Error("TAILORING_CODEX_MODEL must be a valid model ID.");
  const effort=String(environment.TAILORING_CODEX_REASONING_EFFORT||"medium").trim().toLowerCase();
  if(!REASONING_EFFORTS.has(effort))throw new Error("TAILORING_CODEX_REASONING_EFFORT must be none, low, medium, high, or xhigh.");
  const tier=String(environment.TAILORING_CODEX_SERVICE_TIER||"default").trim().toLowerCase();
  if(!["auto","default","fast"].includes(tier))throw new Error("TAILORING_CODEX_SERVICE_TIER must be auto, default, or fast.");
  return["--model",model,"-c",`model_reasoning_effort="${effort}"`,"-c",'model_reasoning_summary="none"',"-c",`service_tier="${tier}"`];
}

// On Windows the child is the Node launcher; child.kill() would leave the native Codex process running.
export function stopProcessTree(child:{pid?:number;kill:()=>unknown},platform=process.platform,launch:typeof spawn=spawn){
  if(platform!=="win32"||!child.pid){child.kill();return;}
  launch("taskkill",["/pid",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"}).on("error",()=>child.kill());
}

export const executeCodex:CodexExecutor=async request=>new Promise((accept,reject)=>{
  const invocation=resolveCodexInvocation();
  const args=["exec",...codexPerformanceArgs(),"--ephemeral","--sandbox","read-only","--ignore-user-config","--skip-git-repo-check","--output-schema",request.schemaPath,"-o",request.outputPath,"-"];
  const child=spawn(invocation.command,[...invocation.prefixArgs,...args],{cwd:request.workspace,env:codexEnvironment(),stdio:["pipe","pipe","pipe"],windowsHide:true});
  let stdout="",stderr="",settled=false;
  const append=(current:string,value:Buffer)=>`${current}${value.toString("utf8")}`.slice(-MAX_LOG_BYTES);
  child.stdout.on("data",value=>{stdout=append(stdout,value);});
  child.stderr.on("data",value=>{stderr=append(stderr,value);});
  const timer=setTimeout(()=>{
    if(settled)return;
    settled=true;stopProcessTree(child);reject(new Error(`Codex execution exceeded ${request.timeoutMs} ms.`));
  },request.timeoutMs);
  child.on("error",error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
  child.on("close",(code,signal)=>{
    if(settled)return;settled=true;clearTimeout(timer);
    if(code!==0)reject(Object.assign(new Error(`Codex exited with code ${code}${signal?` (${signal})`:""}. ${stderr.trim().slice(-2000)}`),{exitCode:code,signal}));
    else accept({stdout,stderr});
  });
  // An early model-process exit can close stdin while its prompt is being sent.
  // Handle EPIPE here instead of letting an unhandled stream error kill the worker.
  child.stdin.on("error",()=>{});
  child.stdin.end(request.prompt,"utf8");
});

export interface RunProofOptions {
  outputPath:string;
  execute?:CodexExecutor;
  schemaPath?:string;
  timeoutMs?:number;
  keepWorkspace?:boolean;
  now?:()=>Date;
}

export function specializeOutputSchema(schema:Record<string,any>,input:TailoringInput){
  const result=structuredClone(schema),experience=result?.properties?.professionalExperience,identifier=experience?.items?.properties?.sourceExperienceId;
  if(!experience||!identifier)throw new Error("Tailoring output schema is missing the professionalExperience identifier contract.");
  experience.minItems=input.sourceResume.professionalExperience.length;
  experience.maxItems=input.sourceResume.professionalExperience.length;
  identifier.enum=input.sourceResume.professionalExperience.map(item=>item.id);
  return result;
}

const normalizeSkill=(value:string)=>value.trim().replace(/\s+/g," ");
const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// Short terms (C, R, Go) match too much ordinary prose to count as evidence; they need the candidate's skills list.
export function skillEvidenced(skill:string,evidence:string){
  const term=normalizeSkill(skill);
  if(term.length<3)return false;
  return new RegExp(`(?<![A-Za-z0-9])${term.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9])`,"i").test(evidence);
}

// JD skills lead for ATS ordering, but only those the candidate's skills list or resume text supports.
// Model additions must also appear in the resume text; the JD alone never adds a skill.
export function completeAtsSkills(generatedSkills:string[],jobSkills:string[],sourceSkills:string[],evidence=""){
  const owned=new Set(sourceSkills.map(skill=>normalizeSkill(skill).toLocaleLowerCase()));
  const supported=(skill:string)=>owned.has(normalizeSkill(skill).toLocaleLowerCase())||skillEvidenced(skill,evidence);
  const seen=new Set<string>(),result:string[]=[];
  for(const raw of [...jobSkills.filter(supported),...sourceSkills,...generatedSkills.filter(skill=>skillEvidenced(skill,evidence))]){
    const skill=raw.trim().replace(/\s+/g," "),key=skill.toLocaleLowerCase();
    if(!skill||seen.has(key))continue;
    seen.add(key);result.push(skill);
    if(result.length===MAX_TAILORED_SKILLS)break;
  }
  return result;
}

// One repair attempt: the rejection reason is worker-written text, appended after the saved prompt.
export const MAX_GENERATION_ATTEMPTS=2;
export const repairPrompt=(prompt:string,reason:string)=>`${prompt}

PREVIOUS ATTEMPT REJECTED
The worker rejected your previous JSON: ${reason}
Return a corrected JSON object that fixes this and still follows every rule above.`;

export async function runTailoringProof(rawInput:unknown,options:RunProofOptions):Promise<TailoringPreview>{
  const input=validateTailoringInput(rawInput),workspace=await mkdtemp(resolve(tmpdir(),"resume-tailoring-v12-"));
  // Saved prompts computed ROLE_TARGETS_JSON at snapshot time; enforce the same limits.
  const referenceDate=input.promptSnapshot?new Date(input.promptSnapshot.referenceDate):new Date(),targets=tailoringRoleTargets(input,referenceDate);
  const schemaSource=resolve(options.schemaPath||OUTPUT_SCHEMA_PATH),schemaPath=resolve(workspace,"tailoring-output.schema.json"),resultPath=resolve(workspace,"codex-result.json"),prompt=buildTailoringPrompt(input,referenceDate),modelContext=tailoringModelContext(input),schema=specializeOutputSchema(JSON.parse(await readFile(schemaSource,"utf8")),input);
  const evidence=[input.sourceResume.summary,...input.sourceResume.professionalExperience.map(role=>role.details)].join("\n");
  try{
    await Promise.all([
      writeFile(resolve(workspace,"input.json"),`${JSON.stringify(modelContext)}\n`,"utf8"),
      writeFile(resolve(workspace,"prompt.md"),`${prompt}\n`,"utf8"),
      writeFile(schemaPath,`${JSON.stringify(schema,null,2)}\n`,"utf8")
    ]);
    let generated:Pick<TailoringOutput,"summary"|"professionalExperience"|"skills">|undefined,rejection="",attempts=0;
    while(!generated&&attempts<MAX_GENERATION_ATTEMPTS){
      attempts++;
      await rm(resultPath,{force:true});
      await(options.execute||executeCodex)({workspace,prompt:attempts===1?prompt:repairPrompt(prompt,rejection),schemaPath,outputPath:resultPath,timeoutMs:options.timeoutMs||300000});
      try{generated=enforceGenerationContract(validateTailoringModelOutput(JSON.parse(await readFile(resultPath,"utf8")),input),targets);}
      catch(error){rejection=error instanceof Error?error.message:String(error);}
    }
    if(!generated)throw new Error(`TAILORING_VALIDATION_FAILED: ${rejection}`);
    const generatedAt=options.now?.()||new Date(),skills=completeAtsSkills(generated.skills,input.jobDescription.skills,input.sourceResume.skills,evidence);
    const result:TailoringOutput={...generated,skills,skillGroups:reconcileSkillGroups(skills),changeSummary:[],unsupportedRequirements:[],warnings:[]};
    const preview:TailoringPreview={contractVersion:input.contractVersion,applicationId:input.application.id,applicationNumber:input.application.applicationNumber,sourceResumeId:input.sourceResume.id,sourceResumeNumber:input.sourceResume.resumeNumber,generatedAt:generatedAt.toISOString(),generationAttempts:attempts,result};
    if(input.promptSnapshot){const{instructions:_instructions,composedPrompt:_prompt,...provenance}=input.promptSnapshot;preview.promptProvenance=provenance;}
    await writeFile(resolve(options.outputPath),`${JSON.stringify(preview,null,2)}\n`,{encoding:"utf8",flag:"wx"});
    return preview;
  }finally{
    if(!options.keepWorkspace)await rm(workspace,{recursive:true,force:true});
    else process.stderr.write(`Isolated workspace retained at ${workspace}\n`);
  }
}

export async function loadFixture(path:string,applicationId:string):Promise<TailoringInput>{
  const fixture=JSON.parse(await readFile(resolve(path),"utf8"));
  if(!fixture||!Array.isArray(fixture.applications))throw new Error("Fixture must contain an applications array.");
  const selected=fixture.applications.find((item:any)=>item?.application?.id===applicationId);
  if(!selected)throw new Error(`Application ${applicationId} was not found in ${basename(path)}.`);
  return validateTailoringInput(selected);
}
