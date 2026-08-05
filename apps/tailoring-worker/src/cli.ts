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
  const args=argumentsFrom(process.argv.slice(2)),fixture=String(args.fixture||""),applicationId=String(args["application-id"]||""),jobId=String(args["job-id"]||""),ticketArgument=String(args.tickets||args.ticket||""),tickets=ticketArgument.split(",").map(value=>value.trim()).filter(Boolean),requestedOutput=String(args.output||"");
  const apiBaseUrl=String(args["api-base-url"]||process.env.TAILORING_API_BASE_URL||""),accessToken=String(process.env.TAILORING_ACCESS_TOKEN||"");
  const fixtureMode=Boolean(fixture||applicationId),apiMode=Boolean(jobId||accessToken),ticketMode=Boolean(tickets.length),modeCount=Number(fixtureMode)+Number(apiMode)+Number(ticketMode);
  if(modeCount!==1)throw new Error("Use exactly one mode: fixture, authenticated job, or --ticket/--tickets with --api-base-url.");
  if(fixtureMode&&(!fixture||!applicationId))throw new Error("Fixture mode requires --fixture and --application-id.");
  if(apiMode&&(!jobId||!apiBaseUrl||!accessToken))throw new Error("API mode requires --job-id, TAILORING_API_BASE_URL (or --api-base-url), and TAILORING_ACCESS_TOKEN.");
  if(ticketMode&&!apiBaseUrl)throw new Error("Ticket mode requires --api-base-url (or TAILORING_API_BASE_URL).");
  if(tickets.length>5||new Set(tickets).size!==tickets.length)throw new Error("Bulk ticket mode accepts between 1 and 5 unique tickets.");
  if(!ticketMode&&!requestedOutput)throw new Error("Fixture and authenticated job modes require --output <new-json-file>.");
  const invocationDirectory=resolve(process.env.INIT_CWD||process.cwd());
  if(ticketMode){
    let completed=0;const failures:string[]=[],claims:Array<{ticket:string;jobId:string;input:any}>=[];
    for(const ticket of tickets){try{const claim=await claimTailoringRunnerTicket(apiBaseUrl,ticket);claims.push({ticket,jobId:claim.jobId,input:claim.input});}catch(error){const message=error instanceof Error?error.message:String(error);failures.push(`unclaimed: ${message}`);process.stderr.write(`A bulk tailoring ticket could not be claimed: ${message}\n`);}}
    for(const claim of claims){const{ticket}=claim;let activeJobId=claim.jobId,phase="GENERATE";
      try{
        const outputPath=resolve(invocationDirectory,`apps/tailoring-worker/artifacts/job-${activeJobId}-${Date.now()}.preview.json`);await mkdir(dirname(outputPath),{recursive:true});phase="GENERATE";
        const preview=await runTailoringProof(claim.input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});phase="SUBMIT";
        await submitTailoringRunnerPreview(apiBaseUrl,ticket,preview);completed++;
        process.stdout.write(`Tailoring preview saved for review for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`);
      }catch(error){const message=error instanceof Error?error.message:String(error),code=phase==="GENERATE"?(message.includes("valid")?"VALIDATION_FAILED":"CODEX_FAILED"):phase==="SUBMIT"?"API_SUBMISSION_FAILED":"WORKER_FAILED";await reportTailoringRunnerFailure(apiBaseUrl,ticket,code).catch(()=>undefined);failures.push(`${activeJobId}: ${message}`);process.stderr.write(`Tailoring job ${activeJobId} failed: ${message}\n`);}
    }
    process.stdout.write(`Bulk tailoring finished: ${completed} completed, ${failures.length} failed.\n`);if(failures.length)throw new Error(`Bulk tailoring completed with failures (${failures.length}/${tickets.length}).`);return;
  }
  const activeJobId=jobId;
  try{
    const output=requestedOutput||`apps/tailoring-worker/artifacts/job-${activeJobId}-${Date.now()}.preview.json`,outputPath=resolve(invocationDirectory,output);
    await mkdir(dirname(outputPath),{recursive:true});
    const input=fixtureMode?await loadFixture(resolve(invocationDirectory,fixture),applicationId):await loadTailoringJobInput(apiBaseUrl,accessToken,jobId);
    const preview=await runTailoringProof(input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});
    if(apiMode)await submitTailoringJobPreview(apiBaseUrl,accessToken,jobId,preview);
    process.stdout.write(`Tailoring preview ${fixtureMode?"created":"saved for review"} for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`);
  }catch(error){
    throw error;
  }
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
