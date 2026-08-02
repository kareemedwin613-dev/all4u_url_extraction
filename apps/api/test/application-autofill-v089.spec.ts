import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/applications/application.service.js";

const user={id:"user-1",token:"jwt",claims:{}},applicationId="123e4567-e89b-42d3-a456-426614174000",sessionId="223e4567-e89b-42d3-a456-426614174000";

test("v0.8.9 API forwards the Application, session, and optional Resume snapshot through a user client",async()=>{
  const calls:any[]=[];
  const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{applicationId,resumeUpdatedAt:"2026-07-29T00:00:00Z",values:{"candidate.email":"person@example.com"}},error:null};}};}}as any);
  await service.autofillContext(user as any,applicationId,{sessionId,resumeUpdatedAt:"2026-07-29T00:00:00Z"});
  assert.deepEqual(calls,[{name:"get_application_autofill_context_v089",args:{p_application_id:applicationId,p_session_id:sessionId,p_expected_resume_updated_at:"2026-07-29T00:00:00Z"}}]);
});

test("v0.8.9 maps review and stale snapshot failures to conflict responses",async()=>{
  for(const code of ["PROFILE_REVIEW_REQUIRED","AUTOFILL_CONTEXT_STALE"]){
    const service=new ApplicationService({forUser:()=>({rpc:async()=>({data:null,error:{message:`${code}: Review required.`}})})}as any);
    await assert.rejects(()=>service.autofillContext(user as any,applicationId,{sessionId}),(error:any)=>error.code===code&&error.status===409);
  }
});

