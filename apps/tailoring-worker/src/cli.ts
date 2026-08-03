import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadFixture, runTailoringProof } from "./codex-runner.js";
import { loadTailoringJobInput, submitTailoringJobPreview } from "./api-client.js";

function argumentsFrom(values:string[]){
  const result:Record<string,string|boolean>={};
  for(let index=0;index<values.length;index++){
    const value=values[index];
    if(value==="--keep-workspace")result.keepWorkspace=true;
    else if(value.startsWith("--")){const next=values[index+1];if(!next||next.startsWith("--"))throw new Error(`${value} requires a value.`);result[value.slice(2)]=next;index++;}
    else throw new Error(`Unknown argument: ${value}.`);
  }
  return result;
}

async function main(){
  const args=argumentsFrom(process.argv.slice(2)),fixture=String(args.fixture||""),applicationId=String(args["application-id"]||""),jobId=String(args["job-id"]||""),output=String(args.output||"");
  const apiBaseUrl=String(args["api-base-url"]||process.env.TAILORING_API_BASE_URL||""),accessToken=String(process.env.TAILORING_ACCESS_TOKEN||"");
  const fixtureMode=Boolean(fixture||applicationId),apiMode=Boolean(jobId||apiBaseUrl);
  if(!output||fixtureMode===apiMode)throw new Error("Use exactly one mode: --fixture <file> --application-id <uuid>, or --job-id <uuid> with TAILORING_API_BASE_URL and TAILORING_ACCESS_TOKEN. Both require --output <new-json-file>.");
  if(fixtureMode&&(!fixture||!applicationId))throw new Error("Fixture mode requires --fixture and --application-id.");
  if(apiMode&&(!jobId||!apiBaseUrl||!accessToken))throw new Error("API mode requires --job-id, TAILORING_API_BASE_URL (or --api-base-url), and TAILORING_ACCESS_TOKEN.");
  const invocationDirectory=resolve(process.env.INIT_CWD||process.cwd()),outputPath=resolve(invocationDirectory,output);
  await mkdir(dirname(outputPath),{recursive:true});
  const input=fixtureMode?await loadFixture(resolve(invocationDirectory,fixture),applicationId):await loadTailoringJobInput(apiBaseUrl,accessToken,jobId);
  const preview=await runTailoringProof(input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});
  if(apiMode)await submitTailoringJobPreview(apiBaseUrl,accessToken,jobId,preview);
  process.stdout.write(`Tailoring preview ${apiMode?"saved for review":"created"} for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`);
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
