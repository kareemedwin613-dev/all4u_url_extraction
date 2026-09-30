import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/applications/application.service.js";

const user={id:"user-1",token:"jwt",claims:{}},sessionId="223e4567-e89b-42d3-a456-426614174000";
function serviceRecording(calls:any[]){return new ApplicationService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{sessionId,status:args.p_status,attempts:1},error:null};}};}}as any);}

test("v3.134 forwards only the privacy-safe attachment outcome through the request user client",async()=>{
  const calls:any[]=[];
  await serviceRecording(calls).recordResumeAttachment(user as any,sessionId,{status:"ATTACHED",code:"RESUME_ATTACHED",adapterId:"greenhouse",targetDomain:"cribl.io",frameDomain:"job-boards.greenhouse.io",embedded:true});
  assert.deepEqual(calls,[{name:"record_application_resume_attachment_v134",args:{p_session_id:sessionId,p_status:"ATTACHED",p_code:"RESUME_ATTACHED",p_adapter_id:"greenhouse",p_target_domain:"cribl.io",p_frame_domain:"job-boards.greenhouse.io",p_embedded:true}}]);
});

test("v3.134 sends nulls for an unknown adapter or frame and clamps the report window",async()=>{
  const calls:any[]=[];
  const service=serviceRecording(calls);
  await service.recordResumeAttachment(user as any,sessionId,{status:"FAILED",code:"RESUME_LOAD_FAILED",targetDomain:"example.com"});
  assert.deepEqual(calls[0].args,{p_session_id:sessionId,p_status:"FAILED",p_code:"RESUME_LOAD_FAILED",p_adapter_id:null,p_target_domain:"example.com",p_frame_domain:null,p_embedded:false});
  await service.resumeAttachmentReport(user as any,365);
  assert.deepEqual(calls[1],{name:"get_resume_attachment_report_v134",args:{p_days:90}});
});
