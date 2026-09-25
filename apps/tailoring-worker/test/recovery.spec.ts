import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBatch } from "../src/cli.js";
import { loadFixture } from "../src/codex-runner.js";
import { claimTailoringBatchTicket } from "../src/api-client.js";
import { workerFailure } from "../src/runner-events.js";

test("restarted tailoring waits for outstanding leases instead of terminating",async()=>{
  const states=["RUNNING","PENDING","WAITING","COMPLETED"],waits:number[]=[];
  await runBatch("https://example.test",`trb_${"x".repeat(43)}`,{},process.cwd(),{
    claim:async()=>({batchId:"test",selectedCount:1}),
    next:async()=>({state:states.shift()!}),sleep:async ms=>{waits.push(ms);},
  });
  assert.equal(states.length,0);assert.deepEqual(waits,[5000,5000,5000]);
});

test("tailoring runner errors distinguish transient API failures from invalid tickets",async()=>{
  const ticket=`trb_${"x".repeat(43)}`;
  for(const [status,code,retryable] of [[503,"TAILORING_RUNNER_ERROR",true],[429,"TAILORING_RUNNER_ERROR",true],[401,"TAILORING_BATCH_TICKET_EXPIRED",false],[500,"TAILORING_BATCH_TICKET_INVALID",false]] as const){
    await assert.rejects(()=>claimTailoringBatchTicket("https://example.test",ticket,async()=>new Response(JSON.stringify({code}),{status})),
      (error:any)=>workerFailure(error).code===code&&workerFailure(error).retryable===retryable);
  }
  await assert.rejects(()=>claimTailoringBatchTicket("https://example.test",ticket,async()=>{throw Error("private details");}),
    (error:any)=>error.code==="TAILORING_API_NETWORK_ERROR"&&error.retryable&&!error.message.includes("private"));
});

test("terminal batch failures have a nonzero exit status and aren't silently successful",async()=>{
  const previous=process.exitCode;
  try{
    await runBatch("https://example.test",`trb_${"x".repeat(43)}`,{},process.cwd(),{
      claim:async()=>({batchId:"test",selectedCount:1}),next:async()=>({state:"COMPLETED_WITH_FAILURES",failedCount:1}),
    });
    assert.equal(process.exitCode,2);
  }finally{process.exitCode=previous;}
});

const batchJob=async(extra:Record<string,unknown>)=>({state:"JOB",batchId:"test",itemId:"item-1",jobId:"job-1",leaseToken:"lease-1",attemptNumber:2,
  input:(await loadFixture(fileURLToPath(new URL("../fixtures/application-19.json",import.meta.url)),"11111111-1111-4111-8111-111111111119")),...extra});
const runOne=async(job:any,dependencies:Record<string,unknown>)=>{
  const directory=await mkdtemp(resolve(tmpdir(),"tailoring-batch-test-")),states:any[]=[job,{state:"COMPLETED"}];
  try{await runBatch("https://example.test",`trb_${"x".repeat(43)}`,{},directory,{claim:async()=>({batchId:"test",selectedCount:1}),next:async()=>states.shift()||{state:"COMPLETED"},sleep:async()=>{},...dependencies});}
  finally{await rm(directory,{recursive:true,force:true});}
};

test("an approved preview whose PDF failed is resubmitted without another model call",async()=>{
  const approved={summary:"Approved summary.",professionalExperience:[],skills:["Python"],skillGroups:[],changeSummary:[],unsupportedRequirements:[],warnings:[]},submitted:any[]=[];
  await runOne(await batchJob({approvedPreview:approved}),{
    generate:async()=>assert.fail("The model must not be called for an approved preview."),
    submit:async(_base:string,_ticket:string,itemId:string,leaseToken:string,preview:any)=>{submitted.push({itemId,leaseToken,preview});return{tailoredResumeNumber:7};},
  });
  assert.equal(submitted.length,1);
  assert.deepEqual(submitted[0].preview.result,approved);
  assert.equal(submitted[0].preview.generationAttempts,0);
  assert.deepEqual([submitted[0].itemId,submitted[0].leaseToken],["item-1","lease-1"]);
});

test("validation failures quoting rate-limit text never pause the batch",async()=>{
  const reports:any[]=[];
  await runOne(await batchJob({}),{
    generate:async()=>{throw new Error('TAILORING_VALIDATION_FAILED: role-1: found "Implemented API rate limiting returning 429 responses".');},
    report:async(_base:string,_ticket:string,_item:string,_lease:string,failure:any)=>{reports.push(failure);return{};},
  });
  assert.equal(reports.length,1);
  assert.deepEqual([reports[0].code,reports[0].rateLimited,reports[0].retryable,reports[0].stage],["VALIDATION_FAILED",false,false,"OUTPUT_VALIDATION"]);
});
