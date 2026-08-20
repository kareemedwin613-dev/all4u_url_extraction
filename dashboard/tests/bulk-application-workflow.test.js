import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {bulkConfirmationCounts,clearRows,creationPayload,defaultEligibleSelection,filterBulkCombinations,pairKey,selectEligible} from "../src/features/bulk-applications/bulk-state.js";
import {createBulkApplications,getApplicationBatch,listApplicationBatchResults,listApplicationBatches,normalizeBulkError,previewBulkApplications} from "../src/features/bulk-applications/bulk-service.js";

const jd1="f3a34ffd-d66a-49f7-815e-c7786857576b",jd2="b4d63a80-e306-4a2f-afca-29cd4b3951e0",resume1="8660f115-ce73-41ff-889b-b6d07202a3e4",resume2="a21c0738-2905-4733-8a1d-d6e0dddb0122";
const rows=[
  {key:pairKey(jd1,resume1),jobDescriptionId:jd1,resumeId:resume1,resumeType:"ORIGINAL",company:"Acme",jobTitle:"Engineer",jobCategoryId:"cat-1",candidateName:"Alex",resumeName:"Alex Main",eligible:true},
  {key:pairKey(jd1,resume2),jobDescriptionId:jd1,resumeId:resume2,resumeType:"ORIGINAL",company:"Acme",jobTitle:"Engineer",jobCategoryId:"cat-1",candidateName:"Blair",resumeName:"Blair Main",eligible:false,existingApplicationId:"existing",exclusionCode:"EXISTING_APPLICATION"},
  {key:pairKey(jd2,resume2),jobDescriptionId:jd2,resumeId:resume2,resumeType:"ORIGINAL",company:"Beta",jobTitle:"Analyst",jobCategoryId:"cat-2",candidateName:"Blair",resumeName:"Blair Main",eligible:true},
];
const preview={combinations:rows,duplicateCount:1};

test("preview selects every eligible non-duplicate pair by default",()=>{
  const selected=defaultEligibleSelection(preview);
  assert.deepEqual([...selected],[rows[0].key,rows[2].key]);
  assert.deepEqual(bulkConfirmationCounts(preview,selected),{selectedJdCount:2,selectedResumeCount:2,applicationCount:2,duplicateCount:1});
  assert.deepEqual(creationPayload(preview,selected),[{job_description_id:jd1,resume_id:resume1},{job_description_id:jd2,resume_id:resume2}]);
});

test("search and every preview filter operate locally without losing stable selection",()=>{
  assert.deepEqual(filterBulkCombinations(rows,{search:"analyst"}).map(x=>x.key),[rows[2].key]);
  assert.deepEqual(filterBulkCombinations(rows,{company:"Acme",candidate:"Alex",resume:"Alex Main",categoryId:"cat-1",eligibility:"ELIGIBLE"}).map(x=>x.key),[rows[0].key]);
  assert.deepEqual(filterBulkCombinations(rows,{eligibility:"EXCLUDED",exclusionCode:"EXISTING_APPLICATION"}).map(x=>x.key),[rows[1].key]);
  let acrossPages=selectEligible([rows[0]],new Set());acrossPages=selectEligible([rows[2]],acrossPages);
  assert.deepEqual([...acrossPages],[rows[0].key,rows[2].key]);
  assert.deepEqual([...clearRows([rows[0]],acrossPages)],[rows[2].key]);
});

test("bulk service makes one preview API request and one idempotent creation API request",async()=>{
  const calls=[],originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");}};globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({data:String(url).endsWith("/preview")?preview:{batchId:"batch",createdCount:2}}),{status:200});};
  try{await previewBulkApplications(client,"https://api.example.com",[jd1,jd1,jd2]);await createBulkApplications(client,"https://api.example.com",creationPayload(preview,defaultEligibleSelection(preview)),"Morning run","retry-key");}finally{globalThis.fetch=originalFetch;}
  assert.match(calls[0].url,/applications\/bulk-preview$/);assert.deepEqual(calls[0].body.jobDescriptionIds,[jd1,jd2]);assert.equal(calls[1].body.combinations.length,2);assert.deepEqual(calls[1].body.combinations[0],{jobDescriptionId:jd1,resumeId:resume1});
});

test("limits, empty requests, authorization, and network interruption have friendly errors",async()=>{
  await assert.rejects(()=>previewBulkApplications({},"https://api.example.com",[]),error=>error.code==="BULK_NO_JDS"&&/Select at least one job description/.test(error.message));
  await assert.rejects(()=>createBulkApplications({},"https://api.example.com",[]),error=>error.code==="BULK_NO_COMBINATIONS"&&/Select at least one eligible combination/.test(error.message));
  assert.equal(normalizeBulkError({code:"42501",message:"policy"}).code,"APPLICATION_ACCESS_DENIED");
  assert.match(normalizeBulkError(new Error("Failed to fetch")).message,/Check Batch History before retrying/);
});

test("batch listing is one paginated, sorted API request",async()=>{let requested;const originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})}};globalThis.fetch=async(url)=>{requested=new URL(url);return new Response(JSON.stringify({data:{items:[],total:30,page:2,pageSize:25,pageCount:2}}),{status:200});};try{const data=await listApplicationBatches(client,"https://api.example.com",{page:2,pageSize:25,status:"COMPLETED",sort:"name_asc"});assert.equal(data.page,2);assert.equal(requested.pathname,"/api/v1/application-batches");assert.equal(requested.searchParams.get("page"),"2");assert.equal(requested.searchParams.get("sort"),"name_asc");}finally{globalThis.fetch=originalFetch;}});

test("batch detail and paginated outcomes use separate backend reads",async()=>{const paths=[],originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})}};globalThis.fetch=async(url)=>{const path=new URL(url).pathname;paths.push(path);return new Response(JSON.stringify({data:path.endsWith("/results")?{items:[],total:0,page:1,pageSize:25}:{id:jd1,name:"Batch",applications:[]}}),{status:200});};try{await getApplicationBatch(client,"https://api.example.com",jd1);await listApplicationBatchResults(client,"https://api.example.com",jd1,{page:1,outcome:"CREATED"});}finally{globalThis.fetch=originalFetch;}assert.deepEqual(paths,[`/api/v1/application-batches/${jd1}`,`/api/v1/application-batches/${jd1}/results`]);});

test("bulk pages use Ant Design, original Resume scope, disabled exclusions, confirmation, and guarded double submission",async()=>{
  const source=await readFile(new URL("../src/features/bulk-applications/bulk-pages.jsx",import.meta.url),"utf8");
  for(const text of ["PreviewSummary","Select Resumes","Only active original Resumes","selectedResumeIds","resumeType === \"ORIGINAL\"","Select all eligible","Select visible eligible","Clear visible selection","Clear all selection","getCheckboxProps","disabled","modal.confirm","Defaults:","submitLock.current","ApplicationBatchesPage","ApplicationBatchDetailPage"])assert.match(source,new RegExp(text));
});

test("JD page exposes selection only behind the bulk capability",async()=>{const source=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");assert.match(source,/APPLICATION_BULK_MANAGE/);assert.match(source,/rowSelection=\{\s*canBulk\s*\?/);assert.match(source,/preserveSelectedRowKeys\s*:\s*true/);assert.match(source,/Create Applications/);});
