import test from "node:test";
import assert from "node:assert/strict";
import { canRequestMatch, canRunMatch, hasPendingMatches, reconcileMatchSelection, MATCHING_MODES } from "../src/features/application-matching/match-state.js";
import { matchingRunnerCommand } from "../src/features/application-matching/runner-command.js";
import { previewBulkApplications, requestApplicationMatches, createBulkApplications } from "../src/features/bulk-applications/bulk-service.js";
import { createApplication, listApplicationResumes } from "../src/features/applications/application-service.js";
import { creationPayload, defaultEligibleSelection } from "../src/features/bulk-applications/bulk-state.js";

test("category mode creates from eligible pairs without offering AI work or polling scoring", () => {
  assert.deepEqual(MATCHING_MODES.map(mode => mode.value), ["SCORE", "CATEGORY"]);
  const row = { key: "pair", jobDescriptionId: "jd", resumeId: "resume", resumeType: "ORIGINAL", matchingMode: "CATEGORY", matchStatus: "NOT_REQUIRED", matchScore: null, eligible: true };
  const preview = { combinations: [row] };
  const selection = defaultEligibleSelection(preview);
  assert.equal(selection.has("pair"), true);
  assert.equal(creationPayload(preview, selection).length, 1);
  assert.equal(canRunMatch(row), false); assert.equal(hasPendingMatches([row]), false);
  // Stale score metadata must not expose a scoring action in category mode.
  assert.equal(canRunMatch({ ...row, exclusionCode: "MATCH_PENDING" }), false);
  assert.equal(hasPendingMatches([{ ...row, matchStatus: "PROCESSING" }]), false);
});

test("both creation workflows send the selected method and category mode makes no queue request", async t => {
  const jd = "f3a34ffd-d66a-49f7-815e-c7786857576b", resume = "8660f115-ce73-41ff-889b-b6d07202a3e4";
  const calls = [], client = { auth: { getSession: async () => ({ data: { session: { access_token: "test" } } }) } };
  const previousFetch = globalThis.fetch; t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async (url, options) => { calls.push({ url, body: options.body ? JSON.parse(options.body) : null }); return new Response(JSON.stringify({ data: [] })); };
  await previewBulkApplications(client, "https://api.example.com", [jd], [resume], "CATEGORY");
  await createBulkApplications(client, "https://api.example.com", [{ jobDescriptionId: jd, resumeId: resume }], "", "retry-key", "CATEGORY");
  await listApplicationResumes(client, "https://api.example.com", jd, "", "CATEGORY");
  await createApplication(client, "https://api.example.com", { jobDescriptionId: jd, resumeId: resume, priority: "NORMAL", matchingMode: "CATEGORY" });
  assert.equal(calls[0].body.matchingMode, "CATEGORY"); assert.equal(calls[1].body.matchingMode, "CATEGORY");
  assert.equal(new URL(calls[2].url).searchParams.get("matchingMode"), "CATEGORY");
  assert.equal(calls[3].body.matchingMode, "CATEGORY");
  assert.ok(calls.every(call => !call.url.includes("application-matches")));
});

test("only unassessed, stale, or failed matches offer scoring; processing polls", () => {
  for (const code of ["MATCH_NOT_ASSESSED", "MATCH_STALE", "MATCH_FAILED"]) assert.equal(canRequestMatch({exclusionCode:code}),true);
  for (const code of ["BELOW_THRESHOLD", "BANNED_COMPANY", "EXISTING_APPLICATION", "MATCH_INSUFFICIENT_DATA", "MATCH_PROCESSING", "PRIMARY_CATEGORY_MISMATCH", "MISSING_CATEGORY"]) assert.equal(canRequestMatch({exclusionCode:code}),false);
  assert.equal(hasPendingMatches([{matchStatus:"PROCESSING"}]),true);
  assert.equal(hasPendingMatches([{matchStatus:"COMPLETED"},{matchStatus:"FAILED"}]),false);
});

test("pending pairs can get a replacement runner command without rescoring completed pairs",()=>{
  for(const exclusionCode of ["MATCH_NOT_ASSESSED","MATCH_FAILED","MATCH_STALE","MATCH_PENDING","MATCH_PROCESSING"]) assert.equal(canRunMatch({exclusionCode}),true);
  for(const exclusionCode of [null,"BELOW_THRESHOLD","BANNED_COMPANY","EXISTING_APPLICATION","MATCH_INSUFFICIENT_DATA","PRIMARY_CATEGORY_MISMATCH","MISSING_CATEGORY"]) assert.equal(canRunMatch({exclusionCode}),false);
});

test("copyable command uses the same API origin and contains no database credential",()=>{
  const ticket="mrb_"+"a".repeat(43),runner={ticket};
  assert.equal(matchingRunnerCommand(runner,"https://api.example.com/"),`npm run matching:run -- --batch-ticket "${ticket}" --api-base-url "https://api.example.com"`);
  for(const base of ['https://api.example.com/"; command','https://api.example.com/$(command)',"https://api.example.com?x=y","http://public.example.com"])
    assert.equal(matchingRunnerCommand(runner,base),"");
  assert.equal(matchingRunnerCommand({ticket:'invalid";command'},"https://api.example.com"),"");
  assert.ok(matchingRunnerCommand(runner,"http://localhost:3000"));
});
test("refresh selects newly passing pairs, retains manual deselection, and removes stale scores", () => {
  const previous=[{key:"manual",eligible:true},{key:"kept",eligible:true},{key:"new",eligible:false},{key:"stale",eligible:true}];
  const next=[{key:"manual",eligible:true},{key:"kept",eligible:true},{key:"new",eligible:true},{key:"stale",eligible:false},{key:"duplicate",eligible:true,existingApplicationId:"exists"}];
  assert.deepEqual([...reconcileMatchSelection(previous,next,new Set(["kept","stale"]))],["kept","new"]);
  assert.equal(creationPayload({combinations:[{key:"stale",eligible:false}]},new Set(["stale"])).length,0);
});
test("restricted preview and queue requests send IDs, not client-provided scores or categories", async t => {
  const jd="f3a34ffd-d66a-49f7-815e-c7786857576b",resume="8660f115-ce73-41ff-889b-b6d07202a3e4";
  const calls=[], client={auth:{getSession:async()=>({data:{session:{access_token:"test"}}})}};
  const previousFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=previousFetch;});
  globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({data:{queuedCount:1}}));};
  await previewBulkApplications(client,"https://api.example.com",[jd,jd],[resume]);
  await requestApplicationMatches(client,"https://api.example.com",[{jobDescriptionId:jd,resumeId:resume,score:100,categoryId:"ignored"}],true);
  assert.deepEqual(calls[0].body,{jobDescriptionIds:[jd],resumeIds:[resume]});
  assert.match(calls[1].url,/\/application-matches$/);
  assert.deepEqual(calls[1].body,{combinations:[{jobDescriptionId:jd,resumeId:resume}],retryFailed:true});
  await assert.rejects(()=>requestApplicationMatches(client,"https://api.example.com",[]),/Select 1 to 5000/);
});
