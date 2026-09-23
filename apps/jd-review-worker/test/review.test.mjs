import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { decide, instructions, isBlank, modelInput, PROMPT_VERSION, savedSource, schemaFor } from "../src/review.mjs";
import { configuration, createApi, runReview } from "../src/cli.mjs";
import { runIdentity, runPaths, safeEvent, workerCommand } from "../../../scripts/worker-supervisor.mjs";

const description="Senior Software Engineer at a financial technology company. Build backend services in C# or Java or both. Remote. Public Trust is required. Salary USD 120000 per year.";
const item = { itemId:"item", leaseToken:"lease", promptVersion:PROMPT_VERSION, model:"gpt-5.6-sol", job: {
  source_url:"https://example.com/never-visit",company:"Example",job_title:"Engineer",category_id:"software",subcategory_ids:[],description_text:description,
  seniority:"UNSPECIFIED",work_arrangement:"REMOTE",industry_domain_category_id:null,travel_required:false,salary_min:0,
}, categories:[{id:"software",parent_id:null,slug:"software-engineering"},{id:"csharp",name:"C#",parent_id:"software"},{id:"java",name:"Java",parent_id:"software"},
  {id:"data",parent_id:null,slug:"data-engineering"},{id:"ai",parent_id:null,slug:"ai-engineering"},{id:"devops",parent_id:null,slug:"devops"}],industries:[{id:"fintech",name:"Fintech"}] };
const source=savedSource(item.job);
const raw = () => ({ primaryCategoryId:"software",subtypeIds:["csharp","java"],uncertainFields:[],comment:"Software Engineering; C# and Java are supported alternatives.",changes:[] });

test("Software Engineering uses both technology alternatives and completes without quotes",()=>{
  for(const wording of ["C# or Java","C# and Java","C# or Java or both"]) {
    const result=decide(raw(),{text:wording},item);
    assert.equal(result.outcome,"AI_REVIEWED");assert.deepEqual(result.changes.subcategory_ids,["csharp","java"]);
    assert.equal(result.changes.category_id,undefined);
  }
  assert.match(instructions,/C# OR Java and C# AND Java/);
});
test("primary corrections and non-SE subtype clearing approve automatically",()=>{
  for(const category of ["data","ai","devops"]) {
    const result=decide({...raw(),primaryCategoryId:category},source,{...item,job:{...item.job,subcategory_ids:["csharp"]}});
    assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.corrected,true);
    assert.equal(result.changes.category_id,category);assert.deepEqual(result.changes.subcategory_ids,[]);
  }
});
test("populated corrections and blank fills are saved without manual review",()=>{
  const result=decide({...raw(),changes:[{field:"industry_domain_category_id",value:"fintech"},{field:"seniority",value:"SENIOR"},
    {field:"job_title",value:"Senior Software Engineer"},{field:"salary_min",value:120000}]},source,item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.corrected,true);assert.equal(result.applyChanges,true);
  assert.equal(result.changes.job_title,"Senior Software Engineer");assert.equal(result.changes.salary_min,120000);
  assert.equal(result.changes.industry_domain_category_id,"fintech");assert.equal(result.changes.seniority,"SENIOR");
  assert.equal(modelInput(item,source).original.source_url,undefined);
});
test("optional ambiguity preserves only that field, not the whole Flodesk-like review",()=>{
  const result=decide({...raw(),primaryCategoryId:"ai",subtypeIds:[],uncertainFields:["salary_period"],
    changes:[{field:"industry_domain_category_id",value:"fintech"},{field:"salary_period",value:"YEAR"}],
    comment:"Industry corrected. Base salary period is not explicit and remains unchanged."},source,item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.changes.category_id,"ai");
  assert.equal(result.changes.salary_period,undefined);assert.equal(result.changes.industry_domain_category_id,"fintech");
  assert.deepEqual(result.preservedFields,["salary_period"]);assert.match(result.comment,/salary_period/);
});
test("ambiguous primary retains existing category while valid metadata is saved",()=>{
  const result=decide({...raw(),primaryCategoryId:null,subtypeIds:[],uncertainFields:["primaryCategoryId"],changes:[{field:"seniority",value:"SENIOR"}]},source,item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.changes.category_id,undefined);assert.equal(result.changes.seniority,"SENIOR");
  assert.match(result.comment,/category_id/);
});
test("no supported SE subtype does not fail or invent tags",()=>{
  for(const existing of [[],["java"]]) {
    const result=decide({...raw(),subtypeIds:[]},source,{...item,job:{...item.job,subcategory_ids:existing}});
    assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.changes.subcategory_ids,undefined);
  }
});
test("invalid values are omitted field-by-field while other valid changes proceed",()=>{
  const result=decide({...raw(),primaryCategoryId:"invented",subtypeIds:["invented"],changes:[
    {field:"source_url",value:"https://other.example"},{field:"industry_domain_category_id",value:"invented"},
    {field:"seniority",value:"SENIOR"},{field:"work_arrangement",value:"UNKNOWN"},{field:"salary_min",value:-1}]},source,item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.deepEqual(result.changes,{seniority:"SENIOR"});
  assert.match(result.comment,/industry_domain_category_id/);
});
test("invalid response shape or no usable primary is a real failure",()=>{
  for(const value of [null,{}, {...raw(),changes:[null]}, {...raw(),comment:""}]) assert.equal(decide(value,source,item).outcome,"FAILED");
  assert.equal(decide({...raw(),primaryCategoryId:null},source,{...item,job:{...item.job,category_id:null}}).outcome,"FAILED");
});
test("same values and reordered tags are not corrections",()=>{
  const result=decide({...raw(),changes:[{field:"company",value:"Example"}]},source,{...item,job:{...item.job,subcategory_ids:["java","csharp"]}});
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.corrected,false);assert.deepEqual(result.changes,{});
});
test("inverted salaries and duplicate field changes do not cancel other changes",()=>{
  const result=decide({...raw(),changes:[{field:"salary_min",value:200},{field:"salary_max",value:100},
    {field:"company",value:"Acme"},{field:"company",value:"Other"},{field:"seniority",value:"SENIOR"}]},source,item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.changes.salary_min,undefined);
  assert.equal(result.changes.company,undefined);assert.equal(result.changes.seniority,"SENIOR");
});
test("blank definition preserves false and zero",()=>{
  for(const value of [null,undefined,"", "  ","UNSPECIFIED",[]])assert.equal(isBlank(value),true);
  for(const value of [false,0,"SENIOR",["C#"]])assert.equal(isBlank(value),false);
});
test("schema constrains classification to supplied taxonomy IDs",()=>{
  const output=schemaFor(item);
  assert.deepEqual(output.properties.primaryCategoryId.enum,["software","data","ai","devops",null]);
  assert.deepEqual(output.properties.subtypeIds.items.enum,["csharp","java"]);
  assert.equal(output.properties.classificationEvidence,undefined);
  assert.equal(output.properties.changes.items.properties.evidence,undefined);
  assert.equal(schemaFor({...item,categories:[]}).properties.subtypeIds.maxItems,0);
});
test("short saved JD is accepted, missing text fails without claiming a review",()=>{
  assert.equal(decide(raw(),savedSource({description_text:"C# or Java."}),item).outcome,"AI_REVIEWED");
  assert.equal(savedSource({description_text:"  "}).error,"SAVED_JD_MISSING");
});
test("classification does not introduce website, hybrid or clearance blocking",()=>{
  const result=decide(raw(),{text:description+" Hybrid or remote. Posting closed."},item);
  assert.equal(result.outcome,"AI_REVIEWED");assert.equal(result.blockReason,undefined);
});
test("scoped API retries transient responses without redirecting credentials",async()=>{
  let count=0;const api=createApi({ticket:"ticket",apiBaseUrl:"https://api.example.com"},async(_url,options)=>{
    assert.equal(options.redirect,"error");assert.equal(JSON.parse(options.body).ticket,"ticket");
    return ++count===1 ? {ok:false,status:503,json:async()=>({code:"TEMPORARY"})} : {ok:true,json:async()=>({data:{done:true}})};
  },async()=>{});
  assert.equal((await api("next")).done,true);assert.equal(count,2);
  assert.throws(()=>configuration(["--batch-ticket","invalid","--api-base-url","https://api.example.com"]));
});
test("two lanes classify saved descriptions without making source network calls",async t=>{
  t.mock.method(globalThis,"fetch",()=>{throw Error("Unexpected website request");});
  let issued=0,active=0,maxActive=0;const saved=[],events=[];
  const api=async(op,body)=>op==="next" ? issued<4 ? {...item,itemId:String(++issued)} : {done:true,failedCount:0} : (saved.push(body),{status:body.result.outcome});
  const result=await runReview({api,provider:settings=>{
    assert.equal(settings.reasoningEffort,"medium");return {generate:async({input,schema})=>{
      assert.equal(input.description,description);assert.ok(schema.properties.primaryCategoryId.enum.includes("software"));active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;return raw();
    }};
  },signals:new EventEmitter(),emit:e=>events.push(e)});
  assert.equal(saved.length,4);assert.equal(maxActive,2);assert.equal(result.status,"COMPLETED");
  assert.equal(saved[0].result.verification.source,"SAVED_JD");assert.equal(saved[0].result.verification.liveUrlChecked,false);
  assert.ok(!events.some(e=>e.stage==="FETCH"));
  assert.doesNotMatch(readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8"),/fetchSource|from ["']\.\/source\.mjs/);
});
test("missing saved descriptions fail without a model call",async()=>{
  let issued=false,saved;
  const result=await runReview({api:async(op,body)=>op==="next" ? issued ? {done:true,failedCount:1} : (issued=true,{...item,job:{...item.job,description_text:""}}) : (saved=body.result,{status:body.result.outcome}),
    provider:()=>{throw Error("Model should not run");},signals:new EventEmitter()});
  assert.equal(saved.outcome,"FAILED");assert.match(saved.comment,/SAVED_JD_MISSING/);assert.equal(result.status,"COMPLETED_WITH_FAILURES");
});
test("legacy batch cannot be silently relabeled as a new prompt version",async()=>{
  let issued=false;
  await assert.rejects(runReview({api:async()=>issued ? {done:true} : (issued=true,{...item,promptVersion:"jd-review-v1"}),
    provider:()=>{throw Error("Model should not run");},signals:new EventEmitter()}),e=>e.code==="JD_REVIEW_NEW_BATCH_REQUIRED");
});
test("persistent quota errors pause instead of marking every JD defective",async()=>{
  let issued=false;const waits=[];
  await assert.rejects(runReview({api:async(op)=>{assert.equal(op,"next");return issued ? {done:true} : (issued=true,item);},
    wait:async ms=>waits.push(ms),signals:new EventEmitter(),provider:()=>({generate:async()=>{throw Object.assign(Error(),{code:"MODEL_RATE_LIMIT",retryable:true});}}),
  }),e=>e.code==="MODEL_RATE_LIMIT" && e.retryable);assert.deepEqual(waits,[60000]);
});
test("supervisor uses the JD worker and keeps ticket out of argv and logs",()=>{
  const ticket="jrb_"+"x".repeat(43),root=process.cwd(),id=runIdentity("jd-review",ticket,"https://api.example.com");
  assert.ok(runPaths(root,id).status.endsWith("status.json"));const command=workerCommand(root,"jd-review",[],ticket);
  assert.ok(command.args.some(x=>/[\\/]jd-review-worker[\\/]src[\\/]cli.mjs$/.test(x)));assert.ok(!command.args.includes(ticket));
  assert.equal(command.options.env.JD_REVIEW_BATCH_TICKET,ticket);assert.equal(safeEvent({code:ticket}).code,undefined);
});
