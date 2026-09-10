import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apiRequest, validateApiBaseUrl } from "../extension/services/api-client.js";
import { createJob } from "../extension/services/job-service.js";
import { listCategories } from "../extension/services/category-service.js";
import { listIndustryDomains } from "../extension/services/industry-domain-service.js";
import { createTailoringJobs, listTailoringJobs } from "../extension/services/tailoring-job-service.js";

test("extension validates configurable API origins",()=>{
  assert.equal(validateApiBaseUrl("https://api.example.com/").normalized,"https://api.example.com");
  assert.equal(validateApiBaseUrl("http://localhost:3000").valid,true);
  assert.equal(validateApiBaseUrl("http://api.example.com").valid,false);
});

test("extension API client sends bearer, request ID, and idempotency headers",async()=>{
  let request;
  const payload=await apiRequest({baseUrl:"https://api.example.com",path:"/api/v1/extension/job-descriptions",method:"POST",token:"user-access-token",idempotencyKey:"jd-request-123",body:{company:"Example"},fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:{id:"1"},requestId:"req_api_1"}),{status:201,headers:{"content-type":"application/json"}});}});
  assert.equal(payload.data.id,"1");
  assert.equal(request.options.headers.Authorization,"Bearer user-access-token");
  assert.equal(request.options.headers["Idempotency-Key"],"jd-request-123");
  assert.match(request.options.headers["X-Request-ID"],/^ext_/);
});

test("extension JD service writes through the protected atomic Supabase RPC",async()=>{
  globalThis.chrome={runtime:{getManifest:()=>({version:"0.7.2"})}};
  let call;
  const client={
    auth:{getSession:async()=>({data:{session:{access_token:"session-token"}},error:null})},
    rpc:async(name,args)=>{call={name,args};return{data:{row:{id:"job",company:"Example",job_title:"Engineer"},duplicate:false,duplicateReason:null},error:null};},
    from:()=>{throw new Error("Direct table write attempted");},
  };
  try { assert.equal((await createJob(client,"https://api.example.com",{sourceUrl:"https://example.com/job",sourceSite:"example.com",company:"Example",jobTitle:"Engineer",descriptionText:"x".repeat(100),categoryId:"11111111-1111-4111-8111-111111111111",seniority:"SENIOR",workArrangement:"REMOTE",clearanceRequirements:[],detectedSkills:[],captureMethod:"dom",extractionConfidence:"high"})).id,"job"); }
  finally { delete globalThis.chrome; }
  assert.equal(call.name,"capture_job_description_v353");
  assert.equal(call.args.p_record.job_title,"Engineer");
  assert.equal(call.args.p_record.normalized_source_url,"https://example.com/job");
  const source=await readFile(new URL("../extension/services/job-service.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\.from\(["']job_descriptions["']\)/);
  assert.doesNotMatch(source,/apiRequest|\/api\/v1\/extension\/job-descriptions/);
  assert.match(source,/\.rpc\("capture_job_description_v353"/);
});

test("extension JD service preserves the backend duplicate result instead of reporting a save",async()=>{
  globalThis.chrome={runtime:{getManifest:()=>({version:"1.9.0"})}};
  const client={auth:{getSession:async()=>({data:{session:{access_token:"session-token"}},error:null})},rpc:async()=>({data:{row:{id:"existing-job",company:"Example",job_title:"Engineer",source_url:"https://example.com/job",created_at:"2026-08-14T00:00:00Z"},duplicate:true,duplicateReason:"SOURCE_URL"},error:null})};
  try{const result=await createJob(client,"https://api.example.com",{sourceUrl:"https://example.com/job",company:"Example",jobTitle:"Engineer"});assert.equal(result.id,"existing-job");assert.equal(result.duplicate,true);assert.equal(result.duplicate_reason,"SOURCE_URL");}
  finally{delete globalThis.chrome;}
  const view=await readFile(new URL("../extension/sidepanel/views/CaptureView.jsx",import.meta.url),"utf8");
  assert.match(view,/if\(saved\.duplicate\)/);
  assert.match(view,/Not saved: this source URL already exists/);
  assert.match(view,/kind:"warning"/);
});

test("extension JD lookups use cached user-scoped Supabase reads without a Vercel hop",async()=>{
  const calls=[];
  const client={from:(table)=>{calls.push(table);const query={select:()=>query,eq:()=>query,order:()=>query,then:(resolve)=>Promise.resolve({data:[{id:table==="categories"?"category":"industry"}],error:null}).then(resolve)};return query;}};
  assert.equal((await listCategories(client,"https://api.example.com"))[0].id,"category");
  assert.equal((await listIndustryDomains(client,"https://api.example.com"))[0].id,"industry");
  assert.equal((await listCategories(client,"https://api.example.com"))[0].id,"category");
  assert.equal((await listIndustryDomains(client,"https://api.example.com"))[0].id,"industry");
  assert.deepEqual(calls,["categories","industry_domain_categories"]);
  const [categories,industries]=await Promise.all([readFile(new URL("../extension/services/category-service.js",import.meta.url),"utf8"),readFile(new URL("../extension/services/industry-domain-service.js",import.meta.url),"utf8")]);
  assert.match(`${categories}${industries}`,/\.from\(["'](?:categories|industry_domain_categories)["']\)/);
  assert.doesNotMatch(`${categories}${industries}`,/apiRequest|\/api\/v1\/lookups/);
});

test("extension maps standardized validation and expired-session errors",async()=>{
  await assert.rejects(()=>apiRequest({baseUrl:"https://api.example.com",path:"/api/v1/extension/job-descriptions",method:"POST",token:"token",idempotencyKey:"request-123",body:{},fetchImpl:async()=>new Response(JSON.stringify({code:"VALIDATION_ERROR",message:"Invalid fields",requestId:"req_2"}),{status:400})}),(error)=>error.code==="VALIDATION_ERROR"&&/Request ID/.test(error.details));
  await assert.rejects(()=>createJob({auth:{getSession:async()=>({data:{session:null},error:null})}},"https://api.example.com",{}),(error)=>error.code==="SESSION_EXPIRED");
});

test("extension tailoring operations use authenticated backend routes",async()=>{const calls=[],originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"session-token"}},error:null})},from:()=>{throw new Error("Direct queue access attempted");},storage:{from:()=>{throw new Error("Direct Storage attempted");}}};globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:String(url).includes("?status=")?[]:[{status:"created",resumeId:"223e4567-e89b-42d3-a456-426614174000"}]}),{status:200});};try{await createTailoringJobs(client,"https://api.example.com","ignored",{id:"123e4567-e89b-42d3-a456-426614174000"},[{resume:{id:"223e4567-e89b-42d3-a456-426614174000",storage_path:"untrusted"},details:{total:80,eligible:true}}]);await listTailoringJobs(client,"https://api.example.com","PENDING");}finally{globalThis.fetch=originalFetch;}assert.deepEqual(calls.map(x=>new URL(x.url).pathname),["/api/v1/tailoring-jobs","/api/v1/tailoring-jobs"]);const body=JSON.parse(calls[0].options.body);assert.equal(body.userId,undefined);assert.equal(body.matches[0].sourceResumePath,undefined);});
