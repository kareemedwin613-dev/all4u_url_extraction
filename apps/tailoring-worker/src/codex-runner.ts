import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, resolve, win32 } from "node:path";
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

export const executeCodex:CodexExecutor=async request=>new Promise((accept,reject)=>{
  const invocation=resolveCodexInvocation();
  const args=["exec","--ephemeral","--sandbox","read-only","--ignore-user-config","--skip-git-repo-check","--output-schema",request.schemaPath,"-o",request.outputPath,"-"];
  const child=spawn(invocation.command,[...invocation.prefixArgs,...args],{cwd:request.workspace,env:codexEnvironment(),stdio:["pipe","pipe","pipe"],windowsHide:true});
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

export function completeAtsSkills(generatedSkills:string[],jobSkills:string[]){
  const seen=new Set<string>(),result:string[]=[];
  for(const raw of [...jobSkills,...generatedSkills]){
    const skill=raw.trim().replace(/\s+/g," "),key=skill.toLocaleLowerCase();
    if(!skill||seen.has(key))continue;
    seen.add(key);result.push(skill);
    if(result.length===250)break;
  }
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
    const generatedAt=options.now?.()||new Date();
    let result:TailoringOutput;try{result=validateTailoringOutput(JSON.parse(await readFile(resultPath,"utf8")),input,generatedAt);result={...result,skills:completeAtsSkills(result.skills,input.jobDescription.skills)};}catch(error){throw new Error(`TAILORING_VALIDATION_FAILED: ${error instanceof Error?error.message:String(error)}`,{cause:error});}
    const preview:TailoringPreview={contractVersion:"1.2",applicationId:input.application.id,applicationNumber:input.application.applicationNumber,sourceResumeId:input.sourceResume.id,sourceResumeNumber:input.sourceResume.resumeNumber,generatedAt:generatedAt.toISOString(),result};
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
