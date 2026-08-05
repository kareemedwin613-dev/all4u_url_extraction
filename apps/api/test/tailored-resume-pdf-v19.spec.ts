import assert from"node:assert/strict";
import test from"node:test";
import{renderTailoredResumePdf}from"../src/platform/tailored-resume-pdf.renderer.js";
import{TailoringService}from"../src/platform/platform.service.js";

const input={applicationNumber:19,renderTemplateKey:"MODERN_V1",candidate:{name:"Alex Example",email:"alex@example.com",phone:"555-0100",city:"Boston",stateRegion:"MA",country:"USA"},sourceStructuredContent:{professional_experience:[{id:"exp-1",company:"Source Co",job_title:"Engineer",experience_details:"Original source",is_current:true}],education:[{institution:"Example University",degree:"BS",field_of_study:"Computer Science"}],certifications:[{name:"AWS Certified"}]},approvedPreview:{summary:"A sufficiently complete approved summary for a tailored Resume artifact.",professionalExperience:[{sourceExperienceId:"exp-1",tailoredDetails:"Delivered supported and measurable engineering improvements.\nImproved platform reliability."}],skills:["SQL","TypeScript"]}};

test("v1.9 renders a bounded template-aware PDF",async()=>{
  const before=structuredClone(input),bytes=await renderTailoredResumePdf(input);
  assert.equal(bytes.subarray(0,5).toString(),"%PDF-");
  assert.ok(bytes.length>1000&&bytes.length<5242880);
  assert.deepEqual(input,before);
});

test("v1.9 PDF materialization stays caller-scoped and finalizes once",async()=>{
  const calls:any[]=[],uploads:any[]=[],started={...input,alreadyMaterialized:false,jobId:"423e4567-e89b-42d3-a456-426614174000",materializationToken:"523e4567-e89b-42d3-a456-426614174000",targetBucket:"tailored-resumes",targetPath:"owner/job/resume.pdf",filename:"resume.pdf",renderFormat:"PDF"};
  const service=new TailoringService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:name==="begin_tailoring_materialization_v19"?started:{status:"COMPLETED",renderFormat:"PDF"},error:null};},storage:{from:(bucket:string)=>({remove:async()=>({data:[],error:null}),upload:async(path:string,bytes:Buffer,options:any)=>{uploads.push({bucket,path,bytes,options});return{data:{path},error:null};}})}};}}as any);
  await service.materialize({id:"actor",token:"jwt",claims:{}},started.jobId);
  assert.deepEqual(calls.map(item=>item.name),["begin_tailoring_materialization_v19","finalize_tailoring_materialization_v19"]);
  assert.equal(uploads[0].bytes.subarray(0,5).toString(),"%PDF-");
  assert.equal(uploads[0].options.contentType,"application/pdf");
  assert.equal(calls[1].args.p_mime_type,"application/pdf");
  assert.match(calls[1].args.p_file_sha256,/^[0-9a-f]{64}$/);
});

test("v1.9 format selection uses only the protected allowlisted RPC",async()=>{
  const calls:any[]=[];const service=new TailoringService({forUser:()=>({rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{renderFormat:args.p_render_format},error:null};}})}as any);
  const result:any=await service.selectFormat({id:"actor",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000",{renderFormat:"PDF",expectedUpdatedAt:"2026-08-03T12:00:00.000Z"});
  assert.equal(result.renderFormat,"PDF");
  assert.deepEqual(calls,[{name:"select_tailoring_format_v19",args:{p_tailoring_job_id:"123e4567-e89b-42d3-a456-426614174000",p_render_format:"PDF",p_expected_updated_at:"2026-08-03T12:00:00.000Z"}}]);
});
