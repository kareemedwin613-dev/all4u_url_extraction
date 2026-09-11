import test from "node:test";
import assert from "node:assert/strict";
import { createMatchingWorker } from "../src/worker.mjs";
import { EXTRACTOR_VERSION, RUBRIC_VERSION, MatchingError } from "../src/scoring.mjs";

test("provider failures record only sanitized codes and never complete an assessment", async () => {
  for (const [failure,code,retryable] of [[new MatchingError("MODEL_RATE_LIMIT",true,45),"MODEL_RATE_LIMIT",true],
    [new MatchingError("MODEL_REFUSED"),"MODEL_REFUSED",false],[new Error("secret source details"),"MATCH_WORKER_ERROR",true]]) {
    const calls=[],logs=[];
    const rpc=async(name,args)=>{
      calls.push({name,args});
      if(name==="claim_application_match")return{id:"job",jdDocumentId:"jd",leaseToken:"pair-lease",attempt:2,rubricVersion:RUBRIC_VERSION,extractorVersion:EXTRACTOR_VERSION,
        scoringMode:"direct-v1",jdSource:{description:"Build React interfaces"},resumeSource:{experience:[{details:"Built React interfaces"}]}};
      if(name==="claim_application_match_document")return{id:"jd",kind:"JD",status:"PROCESSING",leaseToken:"document-lease",source:{description:"React interfaces"}};
      return true;
    };
    const worker=createMatchingWorker({rpc,model:"test-model",provider:{generate:async()=>{throw failure;}},log:event=>logs.push(event)});
    await worker.runOne();
    assert.equal(calls.some(call=>call.name==="complete_application_match"),false);
    assert.equal(calls.some(call=>call.name.includes("match_document")),false);
    const failed=calls.find(call=>call.name==="fail_application_match");assert.equal(failed.args.p_code,code);assert.equal(failed.args.p_retryable,retryable);
    assert.equal(JSON.stringify(logs).includes("secret source details"),false);
    if(code==="MODEL_RATE_LIMIT") {
      assert.equal(failed.args.p_retry_after,90);
      const count=calls.length;assert.equal(await worker.runOne(),false);assert.equal(calls.length,count);
    }
  }
});
test("missing original work experience skips model execution and saves insufficient data",async()=>{
  let result;
  const worker=createMatchingWorker({model:"test-model",provider:{generate:()=>{throw Error("Unexpected call");}},rpc:async(name,args)=>{
    if(name==="claim_application_match")return{id:"job",jdDocumentId:"jd",leaseToken:"pair-lease",attempt:1,rubricVersion:RUBRIC_VERSION,extractorVersion:EXTRACTOR_VERSION,
      scoringMode:"direct-v1",jdSource:{description:"Build React"},resumeSource:{experience:[]}};
    if(name==="complete_application_match"){result=args.p_result;return {status:"INSUFFICIENT_DATA"};}
    throw Error("Unexpected RPC");
  }});
  await worker.runOne();assert.equal(result.sufficient,false);
  assert.ok(Object.values(result.components).every(component=>component.rating===null));
});
