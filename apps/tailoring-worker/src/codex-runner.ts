import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TailoringInput, TailoringOutput, TailoringPreview } from "./types.js";
import { buildTailoringPrompt } from "./prompt.js";
import { validateTailoringInput, validateTailoringOutput } from "./validation.js";

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

export const executeCodex:CodexExecutor=async request=>new Promise((accept,reject)=>{
  const executable=process.env.TAILORING_CODEX_BIN||(process.platform==="win32"?"codex.exe":"codex");
  const args=["exec","--ephemeral","--sandbox","read-only","--ignore-user-config","--skip-git-repo-check","--output-schema",request.schemaPath,"-o",request.outputPath,"-"];
  const child=spawn(executable,args,{cwd:request.workspace,env:codexEnvironment(),stdio:["pipe","pipe","pipe"],windowsHide:true});
  let stdout="",stderr="",settled=false;
  const append=(current:string,value:Buffer)=>`${current}${value.toString("utf8")}`.slice(-MAX_LOG_BYTES);
  child.stdout.on("data",value=>{stdout=append(stdout,value);});
  child.stderr.on("data",value=>{stderr=append(stderr,value);});
  const timer=setTimeout(()=>{
    if(settled)return;
    settled=true;child.kill();reject(new Error(`Codex execution exceeded ${request.timeoutMs} ms.`));
  },request.timeoutMs);
  child.on("error",error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
  child.on("close",code=>{
    if(settled)return;settled=true;clearTimeout(timer);
    if(code!==0)reject(new Error(`Codex exited with code ${code}. ${stderr.trim().slice(-2000)}`));
    else accept({stdout,stderr});
  });
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

export async function runTailoringProof(rawInput:unknown,options:RunProofOptions):Promise<TailoringPreview>{
  const input=validateTailoringInput(rawInput),workspace=await mkdtemp(resolve(tmpdir(),"resume-tailoring-v12-"));
  const schemaSource=resolve(options.schemaPath||OUTPUT_SCHEMA_PATH),schemaPath=resolve(workspace,"tailoring-output.schema.json"),resultPath=resolve(workspace,"codex-result.json"),prompt=buildTailoringPrompt(input),schema=specializeOutputSchema(JSON.parse(await readFile(schemaSource,"utf8")),input);
  try{
    await Promise.all([
      writeFile(resolve(workspace,"input.json"),`${JSON.stringify(input,null,2)}\n`,"utf8"),
      writeFile(resolve(workspace,"prompt.md"),`${prompt}\n`,"utf8"),
      writeFile(schemaPath,`${JSON.stringify(schema,null,2)}\n`,"utf8")
    ]);
    await(options.execute||executeCodex)({workspace,prompt,schemaPath,outputPath:resultPath,timeoutMs:options.timeoutMs||300000});
    const result=validateTailoringOutput(JSON.parse(await readFile(resultPath,"utf8")),input),preview:TailoringPreview={contractVersion:"1.2",applicationId:input.application.id,applicationNumber:input.application.applicationNumber,sourceResumeId:input.sourceResume.id,sourceResumeNumber:input.sourceResume.resumeNumber,generatedAt:(options.now?.()||new Date()).toISOString(),result};
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
