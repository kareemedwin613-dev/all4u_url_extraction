import test from "node:test";
import assert from "node:assert/strict";
import {ApplicationService} from "../src/applications/application.service.js";

const user={id:"123e4567-e89b-42d3-a456-426614174000",token:"caller-jwt",claims:{}};

test("v1.7 Applier list is one set-based caller-scoped RPC",async()=>{
  const calls:any[]=[];
  const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,user.token);return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{items:[{id:"app",status:"ASSIGNED",resume_number:42,resume_type:"TAILORED"}],resumes:[{id:"resume-1",resumeName:"Alex",resumeNumber:1}],total:1,limit:100},error:null};}};}}as any);
  const result:any=await service.mine(user,{status:"ASSIGNED",sort:"updated_desc",limit:100,resumeId:"223e4567-e89b-42d3-a456-426614174000"});
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,"list_my_applications_v19");
  assert.deepEqual(calls[0].args,{p_status:"ASSIGNED",p_sort:"updated_desc",p_limit:100,p_resume_id:"223e4567-e89b-42d3-a456-426614174000"});
  assert.equal(result.items[0].resume_number,42);
  assert.equal(result.resumes[0].resumeName,"Alex");
  assert.equal(result.total,1);
});
test("v1.7 resolves and signs only the Application-attached Resume",async()=>{
  const calls:any[]=[],signed:any[]=[];
  const file={bucket:"tailored-resumes",path:"owner/job/resume.docx",filename:"resume-42.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",fileSizeBytes:1234,resumeNumber:42,resumeType:"TAILORED"};
  const service=new ApplicationService({forUser:(token:string)=>{assert.equal(token,user.token);return{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:file,error:null};},storage:{from:(bucket:string)=>({createSignedUrl:async(path:string,seconds:number)=>{signed.push({bucket,path,seconds});return{data:{signedUrl:"https://project.supabase.co/storage/signed"},error:null};}})}};}}as any);
  const result:any=await service.resumeUrl(user,"223e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(calls,[{name:"get_application_resume_download_v17",args:{p_application_id:"223e4567-e89b-42d3-a456-426614174000"}}]);
  assert.deepEqual(signed,[{bucket:file.bucket,path:file.path,seconds:90}]);
  assert.equal(result.resumeNumber,42);
  assert.equal(result.resumeType,"TAILORED");
});
