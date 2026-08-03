import test from"node:test";
import assert from"node:assert/strict";
import{createHmac}from"node:crypto";

Object.assign(process.env,{NODE_ENV:"test",PORT:"3003",API_BASE_PATH:"api/v1",CORS_ORIGINS:"http://localhost:4173",SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_OR_PUBLISHABLE_KEY:"publishable-test-key-with-safe-length",SUPABASE_JWT_ISSUER:"https://example.supabase.co/auth/v1",SUPABASE_JWKS_URL:"https://example.supabase.co/auth/v1/.well-known/jwks.json",SUPABASE_JWT_AUDIENCE:"authenticated",RATE_LIMIT_TTL_MS:"60000",RATE_LIMIT_MAX:"60",INGESTION_RATE_LIMIT_MAX:"20",LOG_LEVEL:"info",SWAGGER_ENABLED:"true",GOOGLE_WORKSPACE_JD_SYNC_ENABLED:"true",GOOGLE_WORKSPACE_JD_SYNC_URL:"https://script.google.com/macros/s/test/exec",GOOGLE_WORKSPACE_JD_SYNC_SECRET:"0123456789abcdef0123456789abcdef",GOOGLE_WORKSPACE_JD_SYNC_TIMEOUT_MS:"5000"});
const{GoogleWorkspaceJdSyncService}=await import("../src/extension-ingestion/google-workspace-jd-sync.service.js");
const{resetEnvironmentForTests,validateEnvironment}=await import("../src/config/environment.js");
const job={id:"123e4567-e89b-42d3-a456-426614174000",company:"Example",job_title:"Engineer",category_id:"category",subcategory_id:null,industry_domain_category_id:null,seniority:"SENIOR",location_text:"Remote",work_arrangement:"REMOTE",clearance_requirements:[],travel_required:false,travel_details:null,salary_min:100000,salary_max:120000,salary_currency:"USD",salary_period:"YEAR",salary_text:"$100k",source_site:"example.com",source_url:"https://example.com/job",detected_skills:["SQL"],capture_method:"dom",extraction_confidence:"high",created_at:"2026-08-03T00:00:00Z",description_text:"="+"x".repeat(180000)};
const user={id:"223e4567-e89b-42d3-a456-426614174000",email:"finder@example.test",token:"jwt",claims:{}};

test("Google Workspace configuration is optional but strictly validated when enabled",()=>{
  assert.throws(()=>validateEnvironment({...process.env,GOOGLE_WORKSPACE_JD_SYNC_URL:"https://example.com/hook"}),/official Google Apps Script/);
  assert.throws(()=>validateEnvironment({...process.env,GOOGLE_WORKSPACE_JD_SYNC_SECRET:"short"}),/at least 32/);
  assert.equal(validateEnvironment({...process.env,GOOGLE_WORKSPACE_JD_SYNC_ENABLED:"false",GOOGLE_WORKSPACE_JD_SYNC_URL:"",GOOGLE_WORKSPACE_JD_SYNC_SECRET:""}).GOOGLE_WORKSPACE_JD_SYNC_ENABLED,false);
});

test("Google mirror signs one bounded delivery and records success through caller-scoped RPCs",async()=>{
  resetEnvironmentForTests();const calls:any[]=[],originalFetch=globalThis.fetch;let envelope:any;
  globalThis.fetch=async(_url:any,options:any)=>{envelope=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,jdId:job.id}),{status:200,headers:{"Content-Type":"application/json"}});};
  try{
    const service=new GoogleWorkspaceJdSyncService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return name==="begin_google_workspace_jd_sync"?{data:{syncId:"323e4567-e89b-42d3-a456-426614174000",status:"SYNCING",attemptCount:1},error:null}:{data:{status:"SUCCEEDED",attemptCount:1},error:null};}};}}as any,{warn:()=>{}}as any);
    const result=await service.sync(user,job);assert.equal(result.status,"SUCCEEDED");assert.deepEqual(calls.map(x=>x.name),["begin_google_workspace_jd_sync","finish_google_workspace_jd_sync"]);assert.equal(calls[1].args.p_succeeded,true);
    const expected=createHmac("sha256",process.env.GOOGLE_WORKSPACE_JD_SYNC_SECRET!).update(`${envelope.timestamp}.${envelope.payload}`).digest("hex");assert.equal(envelope.signature,expected);
    const payload=JSON.parse(envelope.payload);assert.equal(payload.capturedByUserId,user.id);assert.equal(payload.descriptionChunks.length,5);assert.ok(payload.descriptionChunks.every((value:string)=>value.length<=45000));
  }finally{globalThis.fetch=originalFetch;resetEnvironmentForTests();}
});

test("Google failure never rejects the Supabase save and records a retryable failure",async()=>{
  resetEnvironmentForTests();const calls:any[]=[],originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new DOMException("timed out","TimeoutError");};
  try{
    const service=new GoogleWorkspaceJdSyncService({forUser:()=>({rpc:async(name:string,args:any)=>{calls.push({name,args});return name==="begin_google_workspace_jd_sync"?{data:{syncId:"323e4567-e89b-42d3-a456-426614174000",status:"SYNCING",attemptCount:2},error:null}:{data:{status:"FAILED",attemptCount:2},error:null};}})}as any,{warn:()=>{}}as any);
    const result=await service.sync(user,job);assert.equal(result.status,"FAILED");assert.equal(result.errorCode,"WORKSPACE_TIMEOUT");assert.equal(calls[1].args.p_succeeded,false);assert.equal(calls[1].args.p_error_code,"WORKSPACE_TIMEOUT");
  }finally{globalThis.fetch=originalFetch;resetEnvironmentForTests();}
});
