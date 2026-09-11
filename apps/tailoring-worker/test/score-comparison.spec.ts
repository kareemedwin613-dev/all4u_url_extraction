import test from "node:test";
import assert from "node:assert/strict";
import { scoreMaterializedResume } from "../src/score-comparison.js";

test("materialized resumes launch the existing matching worker with the returned scoped ticket",async()=>{
  const calls:any[]=[],logs:string[]=[],ticket="mrb_"+"a".repeat(43);
  await scoreMaterializedResume({matching:{runner:{ticket}}},"http://localhost:3000","workspace",{
    launch:async options=>{calls.push(options);},log:message=>logs.push(message),
  });
  assert.deepEqual(calls,[{apiBaseUrl:"http://localhost:3000",ticket,repositoryRoot:"workspace"}]);
  assert.match(logs.join(" "),/Evaluating JD alignment/);assert.ok(!logs.join(" ").includes(ticket));
});
test("scoring failure never fails or retries the completed tailoring job",async()=>{
  const logs:string[]=[];
  await scoreMaterializedResume({matching:{runner:{ticket:"mrb_"+"a".repeat(43)}}},"http://localhost:3000","workspace",{
    launch:async()=>{throw new Error("private provider failure");},log:message=>logs.push(message),
  });
  assert.match(logs.join(" "),/Resume is still created/);assert.doesNotMatch(logs.join(" "),/private provider failure/);
});
test("cached, unavailable, invalid-ticket, and older API receipts do not start extra model calls",async()=>{
  for(const receipt of [{},{matching:{runner:null}},{matching:{errorCode:"MATCHING_NOT_CONFIGURED"}}, {matching:{runner:{ticket:"bad"}}}]){
    await scoreMaterializedResume(receipt,"http://localhost:3000","workspace",{launch:async()=>assert.fail("Unexpected model call"),log:()=>{}});
  }
});
