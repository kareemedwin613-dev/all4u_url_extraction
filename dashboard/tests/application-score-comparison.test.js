import test from "node:test";
import assert from "node:assert/strict";
import { comparisonDifference, comparisonNeedsEvaluation, comparisonPending, comparisonScoreLabel } from "../src/features/application-matching/comparison-state.js";
import { getApplicationMatchComparison, requestApplicationMatchComparison } from "../src/features/applications/application-service.js";

const score = number => ({ status: "COMPLETED", isCurrent: true, score: number });
test("comparison shows positive, negative and unchanged differences only for current completed scores", () => {
  for (const difference of [12,-8,0]) assert.equal(comparisonDifference({comparable:true,original:score(80),tailored:score(80+difference)}),difference);
  for (const status of ["STALE","PENDING","PROCESSING","FAILED","INSUFFICIENT_DATA"]) {
    assert.equal(comparisonDifference({comparable:true,original:score(80),tailored:{...score(90),status}}),null);
  }
  assert.equal(comparisonDifference({comparable:false,original:score(80),tailored:score(90)}),null);
  assert.equal(comparisonDifference({comparable:true,original:score(80),tailored:null}),null);
  assert.equal(comparisonDifference({comparable:true,original:score(80),tailored:{...score(90),isCurrent:false}}),null);
});
test("missing tailored scores are not zero and stale historical scores are visibly labeled", () => {
  assert.equal(comparisonScoreLabel(null),"Not tailored yet");
  assert.equal(comparisonScoreLabel({status:"NOT_ASSESSED",score:null}),"Not evaluated");
  assert.match(comparisonScoreLabel({...score(80),status:"STALE"}),/80\/100.*outdated/);
  assert.equal(comparisonPending({tailored:{status:"PROCESSING"}}),true);
  assert.equal(comparisonPending({original:score(80),tailored:score(90)}),false);
  assert.equal(comparisonNeedsEvaluation({matchingConfigured:true,original:score(80),tailored:{status:"NOT_ASSESSED"}}),true);
  assert.equal(comparisonNeedsEvaluation({matchingConfigured:true,original:score(80),tailored:score(90)}),false);
  assert.equal(comparisonNeedsEvaluation({matchingConfigured:false,original:{status:"NOT_ASSESSED"}}),false);
});
test("reading scores is read-only; requesting a comparison sends only the Application ID", async t => {
  const calls=[], client={auth:{getSession:async()=>({data:{session:{access_token:"test"}}})}};
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method,body:options.body});return new Response(JSON.stringify({data:{}}));};
  await getApplicationMatchComparison(client,"https://api.example.com","app");
  await requestApplicationMatchComparison(client,"https://api.example.com","app");
  assert.deepEqual(calls,[{url:"https://api.example.com/api/v1/applications/app/match-comparison",method:"GET",body:undefined},
    {url:"https://api.example.com/api/v1/applications/app/match-comparison",method:"POST",body:"{}"}]);
});
