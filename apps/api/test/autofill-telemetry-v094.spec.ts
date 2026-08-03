import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/applications/application.service.js";

const user={id:"user-1",token:"jwt",claims:{}},sessionId="223e4567-e89b-42d3-a456-426614174000";

test("v0.9.4 forwards only the validated telemetry contract through the request user client",async()=>{
  const calls:any[]=[];
  const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{id:sessionId},error:null};}};}}as any);
  const body={resumeUpdatedAt:"2026-08-02T12:00:00Z",adapterId:"greenhouse",adapterVersion:"1.0.0",targetDomain:"job-boards.greenhouse.io",detectedCount:1,selectedCount:1,succeededCount:1,failedCount:0,unresolvedCount:0,fields:[{fieldKey:"candidate.email",fieldIndex:0,confidence:93,outcome:"VERIFIED",errorCode:"FIELD_VERIFIED"}]};
  await service.recordAutofillTelemetry(user as any,sessionId,body);
  assert.deepEqual(calls,[{name:"record_application_autofill_telemetry_v094",args:{p_session_id:sessionId,p_resume_updated_at_snapshot:body.resumeUpdatedAt,p_adapter_id:body.adapterId,p_adapter_version:body.adapterVersion,p_target_domain:body.targetDomain,p_detected_count:1,p_selected_count:1,p_succeeded_count:1,p_failed_count:0,p_unresolved_count:0,p_fields:body.fields}}]);
});

test("a missing Autofill RPC reports the pending database migration",async()=>{
  const service=new ApplicationService({forUser:()=>({rpc:async()=>({data:null,error:{code:"PGRST202",message:"Could not find the function public.update_application_autofill_recovery_v096 in the schema cache"}})})}as any);
  await assert.rejects(()=>service.updateAutofillRecovery(user as any,sessionId,{targetOrigin:"https://example.com",stepIdentifier:"DETECTED",resumeUpdatedAt:"2026-08-02T00:00:00Z"}),(error:any)=>error?.code==="DATABASE_MIGRATION_REQUIRED"&&error?.status===503);
});
