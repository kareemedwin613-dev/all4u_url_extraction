import assert from"node:assert/strict";
import test from"node:test";
import{TailoringBatchRunnerService}from"../src/platform/tailoring-batch.service.js";

test("batch preview submission automatically materializes before completing the item",async()=>{
  const calls:any[]=[],uploads:any[]=[];
  const started={alreadyMaterialized:false,jobId:"423e4567-e89b-42d3-a456-426614174000",applicationNumber:19,materializationToken:"523e4567-e89b-42d3-a456-426614174000",targetBucket:"tailored-resumes",targetPath:"owner/job/resume.pdf",filename:"resume.pdf",renderFormat:"PDF",candidate:{name:"Alex Example"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Source Co",job_title:"Engineer",experience_details:"source"}],education:[],certifications:[]},approvedPreview:{summary:"A complete approved summary for the target role and candidate.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered measurable engineering improvements for customers and internal teams."}],skills:["SQL"]}};
  const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:name==="begin_tailoring_batch_materialization_v34"?started:name==="finalize_tailoring_batch_materialization_v34"?{status:"COMPLETED",tailoredResumeNumber:42,renderTemplateKey:"IMPACT_V1"}:{status:"APPROVED"},error:null};},storage:{from:(bucket:string)=>({remove:async()=>({data:[],error:null}),upload:async(path:string,bytes:Buffer,options:any)=>{uploads.push({bucket,path,bytes,options});return{data:{path},error:null};}})}};
  const service=new TailoringBatchRunnerService({anonymous:()=>client}as any),ticket=`trb_${"b".repeat(43)}`,itemId="623e4567-e89b-42d3-a456-426614174000",leaseToken="723e4567-e89b-42d3-a456-426614174000";
  const result:any=await service.preview({ticket,itemId,leaseToken,generatedAt:"2026-09-01T12:00:00Z",result:{summary:"x"}});
  assert.equal(result.status,"COMPLETED");
  assert.equal(result.renderTemplateKey,"IMPACT_V1");
  assert.equal(result.automaticMaterialization,true);
  assert.deepEqual(calls.map(call=>call.name),["submit_tailoring_batch_preview_v21","begin_tailoring_batch_materialization_v34","finalize_tailoring_batch_materialization_v34"]);
  assert.ok(calls.every(call=>call.args.p_ticket===ticket));
  assert.equal(uploads.length,1);
  assert.equal(uploads[0].bytes.subarray(0,5).toString(),"%PDF-");
  assert.equal(uploads[0].options.contentType,"application/pdf");
  assert.equal(uploads[0].options.upsert,false);
  assert.match(calls[2].args.p_file_sha256,/^[0-9a-f]{64}$/);
});
