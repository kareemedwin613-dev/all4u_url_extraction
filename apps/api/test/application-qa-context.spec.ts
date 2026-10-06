import test from "node:test";
import assert from "node:assert/strict";
import {ApplicationService} from "../src/applications/application.service.js";
const user={id:"123e4567-e89b-42d3-a456-426614174000",token:"caller-jwt",claims:{}};
test("Q&A context uses one caller-scoped RPC and preserves full text",async()=>{
  const context={resumeType:"TAILORED",resumeText:"Complete attached Resume",jobDescription:"Complete JD"};
  let calls=0;
  const service=new ApplicationService({forUser:(token:string)=>{
    assert.equal(token,user.token);return{rpc:async(name:string,args:any)=>{
      calls++;assert.equal(name,"get_application_qa_context_v3154");assert.deepEqual(args,{p_application_id:"application"});
      return{data:context,error:null};
    }};
  }}as any);
  assert.deepEqual(await service.qaContext(user,"application"),context);assert.equal(calls,1);
});
test("Q&A context propagates access and missing migration errors",async()=>{
  for(const [error,message] of [[{code:"42501",message:"APPLICATION_ACCESS_DENIED: Access denied."},/Access denied/],[{code:"PGRST202",message:"could not find the function"},/Apply the pending Supabase migrations/]]as const){
    const service=new ApplicationService({forUser:()=>({rpc:async()=>({data:null,error})})}as any);
    await assert.rejects(()=>service.qaContext(user,"application"),message);
  }
});
