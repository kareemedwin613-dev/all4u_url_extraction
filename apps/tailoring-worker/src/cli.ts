import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadFixture, runTailoringProof } from "./codex-runner.js";
import { claimTailoringBatchTicket, claimTailoringRunnerTicket, loadTailoringJobInput, nextTailoringBatchItem, reportTailoringBatchFailure, reportTailoringRunnerFailure, submitTailoringBatchPreview, submitTailoringJobPreview, submitTailoringRunnerPreview } from "./api-client.js";

export function isRateLimitFailure(value:unknown){return /(?:\b429\b|rate[ -]?limit|usage limit|too many requests|quota[^.\n]*(?:exceed|reset)|capacity[^.\n]*(?:reached|exceeded))/i.test(value instanceof Error?value.message:String(value));}
export function retryDelaySeconds(value:unknown,attempt=1){const text=value instanceof Error?value.message:String(value),match=text.match(/retry(?: after| in)?[^\d]{0,20}(\d{1,4})\s*(?:s|sec|seconds?)\b/i),fallback=60*Math.pow(2,Math.max(0,attempt-1));return Math.max(30,Math.min(900,Number(match?.[1]||fallback)));}
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function runBatch(apiBaseUrl:string,ticket:string,args:Record<string,string|boolean>,invocationDirectory:string){
  const claim=await claimTailoringBatchTicket(apiBaseUrl,ticket);
  process.stdout.write(`Tailoring batch ${claim.batchId} claimed. ${claim.selectedCount||0} Applications selected.\n`);
  for(;;){
    const next=await nextTailoringBatchItem(apiBaseUrl,ticket);
    if(next.state==="SKIPPED"){process.stderr.write(`Skipped batch item ${String(next.itemId||"")}: ${String(next.reason||"invalid source")}\n`);continue;}
    if(next.state==="RATE_LIMITED"){
      const retryAt=new Date(String(next.nextRetryAt||Date.now()+60000)),delay=Math.max(1000,retryAt.getTime()-Date.now());
      process.stderr.write(`Provider rate limit reached. Batch paused until ${retryAt.toISOString()}; the same command will resume automatically.\n`);
      let remaining=delay;while(remaining>0){const duration=Math.min(60000,remaining);await wait(duration);remaining-=duration;}continue;
    }
    if(["COMPLETED","COMPLETED_WITH_FAILURES","CANCELLED"].includes(next.state)){const result=next as Record<string,unknown>;process.stdout.write(`Tailoring batch finished with status ${next.state}. Failed=${result.failedCount||0}, skipped=${result.skippedCount||0}.\n`);return;}
    if(next.state!=="JOB")throw new Error(`Unexpected tailoring batch state: ${next.state}`);
    const outputPath=resolve(invocationDirectory,`apps/tailoring-worker/artifacts/job-${next.jobId}-${Date.now()}.preview.json`);await mkdir(dirname(outputPath),{recursive:true});
    const started=Date.now();let stage="CODEX_GENERATION";
    try{
      const preview=await runTailoringProof(next.input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});stage="API_SUBMISSION";
      const created:any=await submitTailoringBatchPreview(apiBaseUrl,ticket,String(next.itemId),String(next.leaseToken),preview);
      process.stdout.write(`Tailored Resume${created?.tailoredResumeNumber?` #${created.tailoredResumeNumber}`:""} automatically created with ${created?.renderTemplateKey||"a random template"} for Application #${preview.applicationNumber}: ${outputPath}\n`);
    }catch(error){
      const message=error instanceof Error?error.message:String(error),rateLimited=isRateLimitFailure(error),validation=message.startsWith("TAILORING_VALIDATION_FAILED:"),code=rateLimited?"PROVIDER_RATE_LIMIT":validation?"VALIDATION_FAILED":stage==="API_SUBMISSION"?"API_SUBMISSION_FAILED":"CODEX_FAILED";
      await reportTailoringBatchFailure(apiBaseUrl,ticket,String(next.itemId),String(next.leaseToken),{stage:validation?"OUTPUT_VALIDATION":stage,code,message,retryable:!validation,rateLimited,retryAfterSeconds:rateLimited?retryDelaySeconds(error,Number(next.attemptNumber||1)):undefined}).catch(reportError=>process.stderr.write(`Failure diagnostics could not be recorded: ${reportError instanceof Error?reportError.message:String(reportError)}\n`));
      process.stderr.write(`Tailoring job ${next.jobId} failed after ${Date.now()-started} ms [${code}]: ${message}\n`);
    }
  }
}

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
  const args=argumentsFrom(process.argv.slice(2)),fixture=String(args.fixture||""),applicationId=String(args["application-id"]||""),jobId=String(args["job-id"]||""),ticketArgument=String(args.tickets||args.ticket||""),tickets=ticketArgument.split(",").map(value=>value.trim()).filter(Boolean),batchTicket=String(args["batch-ticket"]||""),requestedOutput=String(args.output||"");
  const apiBaseUrl=String(args["api-base-url"]||process.env.TAILORING_API_BASE_URL||""),accessToken=String(process.env.TAILORING_ACCESS_TOKEN||"");
  const fixtureMode=Boolean(fixture||applicationId),apiMode=Boolean(jobId||accessToken),ticketMode=Boolean(tickets.length),batchMode=Boolean(batchTicket),modeCount=Number(fixtureMode)+Number(apiMode)+Number(ticketMode)+Number(batchMode);
  if(modeCount!==1)throw new Error("Use exactly one mode: fixture, authenticated job, --ticket/--tickets, or --batch-ticket with --api-base-url.");
  if(fixtureMode&&(!fixture||!applicationId))throw new Error("Fixture mode requires --fixture and --application-id.");
  if(apiMode&&(!jobId||!apiBaseUrl||!accessToken))throw new Error("API mode requires --job-id, TAILORING_API_BASE_URL (or --api-base-url), and TAILORING_ACCESS_TOKEN.");
  if(ticketMode&&!apiBaseUrl)throw new Error("Ticket mode requires --api-base-url (or TAILORING_API_BASE_URL).");
  if(batchMode&&!apiBaseUrl)throw new Error("Batch ticket mode requires --api-base-url (or TAILORING_API_BASE_URL).");
  if(tickets.length>5||new Set(tickets).size!==tickets.length)throw new Error("Bulk ticket mode accepts between 1 and 5 unique tickets.");
  if((fixtureMode||apiMode)&&!requestedOutput)throw new Error("Fixture and authenticated job modes require --output <new-json-file>.");
  const invocationDirectory=resolve(process.env.INIT_CWD||process.cwd());
  if(batchMode){await runBatch(apiBaseUrl,batchTicket,args,invocationDirectory);return;}
  if(ticketMode){
    let completed=0;const failures:string[]=[],claims:Array<{ticket:string;jobId:string;input:any}>=[];
    for(const ticket of tickets){try{const claim=await claimTailoringRunnerTicket(apiBaseUrl,ticket);claims.push({ticket,jobId:claim.jobId,input:claim.input});}catch(error){const message=error instanceof Error?error.message:String(error);failures.push(`unclaimed: ${message}`);process.stderr.write(`A bulk tailoring ticket could not be claimed: ${message}\n`);}}
    for(const claim of claims){const{ticket}=claim;let activeJobId=claim.jobId,phase="GENERATE";
      try{
        const outputPath=resolve(invocationDirectory,`apps/tailoring-worker/artifacts/job-${activeJobId}-${Date.now()}.preview.json`);await mkdir(dirname(outputPath),{recursive:true});phase="GENERATE";
        const preview=await runTailoringProof(claim.input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});phase="SUBMIT";
        const created:any=await submitTailoringRunnerPreview(apiBaseUrl,ticket,preview);completed++;
        process.stdout.write(`Tailored Resume${created?.tailoredResumeNumber?` #${created.tailoredResumeNumber}`:""} automatically created with ${created?.renderTemplateKey||"a random template"} for Application #${preview.applicationNumber}: ${outputPath}\n`);
      }catch(error){const message=error instanceof Error?error.message:String(error),code=phase==="GENERATE"?(message.startsWith("TAILORING_VALIDATION_FAILED:")?"VALIDATION_FAILED":"CODEX_FAILED"):phase==="SUBMIT"?"API_SUBMISSION_FAILED":"WORKER_FAILED";await reportTailoringRunnerFailure(apiBaseUrl,ticket,code).catch(()=>undefined);failures.push(`${activeJobId}: ${message}`);process.stderr.write(`Tailoring job ${activeJobId} failed: ${message}\n`);}
    }
    process.stdout.write(`Bulk tailoring finished: ${completed} completed, ${failures.length} failed.\n`);if(failures.length)throw new Error(`Bulk tailoring completed with failures (${failures.length}/${tickets.length}).`);return;
  }
  const activeJobId=jobId;
  try{
    const output=requestedOutput||`apps/tailoring-worker/artifacts/job-${activeJobId}-${Date.now()}.preview.json`,outputPath=resolve(invocationDirectory,output);
    await mkdir(dirname(outputPath),{recursive:true});
    const input=fixtureMode?await loadFixture(resolve(invocationDirectory,fixture),applicationId):await loadTailoringJobInput(apiBaseUrl,accessToken,jobId);
    const preview=await runTailoringProof(input,{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});
    const created:any=apiMode?await submitTailoringJobPreview(apiBaseUrl,accessToken,jobId,preview):null;
    process.stdout.write(fixtureMode?`Tailoring preview created for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`:`Tailored Resume${created?.tailoredResumeNumber?` #${created.tailoredResumeNumber}`:""} automatically created with ${created?.renderTemplateKey||"a random template"} for Application #${preview.applicationNumber}: ${outputPath}\n`);
  }catch(error){
    throw error;
  }
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
