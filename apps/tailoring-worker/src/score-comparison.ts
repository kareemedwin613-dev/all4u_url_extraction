import { spawn } from "node:child_process";
import { resolve } from "node:path";

type Launch = (options:{apiBaseUrl:string;ticket:string;repositoryRoot:string})=>Promise<void>;
const launch:Launch=({apiBaseUrl,ticket,repositoryRoot})=>new Promise((resolveRun,reject)=>{
  const child=spawn(process.execPath,[
    `--env-file-if-exists=${resolve(repositoryRoot,"apps/matching-worker/.env")}`,
    resolve(repositoryRoot,"apps/matching-worker/src/cli.mjs"),"--batch-ticket",ticket,"--api-base-url",apiBaseUrl,
  ],{cwd:repositoryRoot,stdio:"inherit",windowsHide:true,shell:false,
    // Each tailoring slot already runs in parallel; avoid multiplying concurrency.
    env:{...process.env,MATCHING_CONCURRENCY:"1"}});
  child.once("error",reject);
  child.once("exit",code=>code===0?resolveRun():reject(new Error("COMPARISON_WORKER_FAILED")));
});

export async function scoreMaterializedResume(receipt:any,apiBaseUrl:string,repositoryRoot:string,
  dependencies:{launch?:Launch;log?:(message:string)=>void}={}){
  const log=dependencies.log||((message:string)=>process.stdout.write(`${message}\n`));
  const matching=receipt?.matching;
  if(!matching)return; // Compatible with older APIs and fixture-only generation.
  if(matching.errorCode){log("Resume created. Comparison could not be queued; use Evaluate / resume comparison in Application details.");return;}
  if(!matching.runner){log("Resume created. Available comparison scores are already cached.");return;}
  if(!/^mrb_[A-Za-z0-9_-]{43}$/.test(matching.runner.ticket||"")){
    log("Resume created. Comparison command was invalid; request a new comparison in Application details.");return;
  }
  log("Resume created. Evaluating JD alignment for the score comparison…");
  try{await(dependencies.launch||launch)({apiBaseUrl,ticket:matching.runner.ticket,repositoryRoot});}
  catch{log("Resume is still created. Score comparison did not finish; use Evaluate / resume comparison in Application details.");}
}
