import test from "node:test";
import assert from "node:assert/strict";
import { runBatch } from "../src/cli.js";
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
