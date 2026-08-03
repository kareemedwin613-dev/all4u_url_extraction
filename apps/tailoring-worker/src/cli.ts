import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadFixture, runTailoringProof } from "./codex-runner.js";
import { claimTailoringRunnerTicket, loadTailoringJobInput, reportTailoringRunnerFailure, submitTailoringJobPreview, submitTailoringRunnerPreview } from "./api-client.js";

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
  const args=argumentsFrom(process.argv.slice(2)),fixture=String(args.fixture||""),applicationId=String(args["application-id"]||""),jobId=String(args["job-id"]||""),ticket=String(args.ticket||""),requestedOutput=String(args.output||"");
  const apiBaseUrl=String(args["api-base-url"]||process.env.TAILORING_API_BASE_URL||""),accessToken=String(process.env.TAILORING_ACCESS_TOKEN||"");
  const fixtureMode=Boolean(fixture||applicationId),apiMode=Boolean(jobId||accessToken),ticketMode=Boolean(ticket),modeCount=Number(fixtureMode)+Number(apiMode)+Number(ticketMode);
  if(modeCount!==1)throw new Error("Use exactly one mode: fixture, authenticated job, or --ticket with --api-base-url.");
  if(fixtureMode&&(!fixture||!applicationId))throw new Error("Fixture mode requires --fixture and --application-id.");
  if(apiMode&&(!jobId||!apiBaseUrl||!accessToken))throw new Error("API mode requires --job-id, TAILORING_API_BASE_URL (or --api-base-url), and TAILORING_ACCESS_TOKEN.");
  if(ticketMode&&(!apiBaseUrl||!ticket))throw new Error("Ticket mode requires --ticket and --api-base-url (or TAILORING_API_BASE_URL).");
  if(!ticketMode&&!requestedOutput)throw new Error("Fixture and authenticated job modes require --output <new-json-file>.");
  const invocationDirectory=resolve(process.env.INIT_CWD||process.cwd());let activeJobId=jobId,phase="CLAIM",claimed=false;
  try{
    const claimedRun=ticketMode?await claimTailoringRunnerTicket(apiBaseUrl,ticket):null;claimed=Boolean(claimedRun);activeJobId=claimedRun?.jobId||jobId;
    const output=requestedOutput||`apps/tailoring-worker/artifacts/job-${activeJobId}-${Date.now()}.preview.json`,outputPath=resolve(invocationDirectory,output);
    await mkdir(dirname(outputPath),{recursive:true});phase="GENERATE";
    const input=fixtureMode?await loadFixture(resolve(invocationDirectory,fixture),applicationId):ticketMode?claimedRun!.input:await loadTailoringJobInput(apiBaseUrl,accessToken,jobId);
    const preview=await runTailoringProof(input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});phase="SUBMIT";
    if(ticketMode)await submitTailoringRunnerPreview(apiBaseUrl,ticket,preview);else if(apiMode)await submitTailoringJobPreview(apiBaseUrl,accessToken,jobId,preview);
    process.stdout.write(`Tailoring preview ${fixtureMode?"created":"saved for review"} for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`);
  }catch(error){
    if(ticketMode&&claimed){const code=phase==="GENERATE"?(String(error).includes("valid")?"VALIDATION_FAILED":"CODEX_FAILED"):phase==="SUBMIT"?"API_SUBMISSION_FAILED":"WORKER_FAILED";await reportTailoringRunnerFailure(apiBaseUrl,ticket,code).catch(()=>undefined);}
    throw error;
  }
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
