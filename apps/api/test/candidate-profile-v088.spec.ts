import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {CandidateService} from "../src/candidates/candidate.service.js";

const user={id:"user-1",token:"user-jwt",claims:{}},resumeId="123e4567-e89b-42d3-a456-426614174000";
function fixture(){const calls:any[]=[];const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{id:resumeId,reviewStatus:"NEEDS_REVIEW"},error:null};}};return{calls,service:new CandidateService({forUser:(token:string)=>{assert.equal(token,user.token);return client;}}as any)};}

test("Resume autofill metadata reads and writes use the request-scoped user client",async()=>{
  const{calls,service}=fixture();
  await service.get(user as any,resumeId);
  await service.update(user as any,resumeId,{fullName:"Jordan Lee",email:"JORDAN@EXAMPLE.COM",phone:" 202-555-0148 ",reviewStatus:"VERIFIED",primaryAddress:{city:"Austin"},links:[{linkType:"LINKEDIN",url:"https://linkedin.com/in/jordan"}]}as any);
  assert.deepEqual(calls.map(x=>x.name),["get_candidate_autofill_profile_v088","update_candidate_profile_v088"]);
  assert.equal(calls[0].args.p_resume_id,resumeId);
  assert.equal(calls[1].args.p_email,"jordan@example.com");
  assert.equal(calls[1].args.p_phone,"202-555-0148");
  assert.deepEqual(calls[1].args.p_primary_address,{city:"Austin"});
});

test("employment and education mutations send allowlisted RPC arguments",async()=>{
  const{calls,service}=fixture();
  await service.employment(user as any,resumeId,{company:"Acme",jobTitle:"Engineer",isCurrent:true,endDate:"2024-01-01",displayOrder:2}as any);
  await service.education(user as any,resumeId,{institution:"State University",degree:"BS",displayOrder:1}as any,"223e4567-e89b-42d3-a456-426614174000");
  assert.equal(calls[0].name,"save_candidate_employment_v088");assert.equal(calls[0].args.p_end_date,null);assert.equal(calls[0].args.p_is_current,true);assert.equal(calls[0].args.p_employment_id,null);
  assert.equal(calls[1].name,"save_candidate_education_v088");assert.ok(calls[1].args.p_education_id);
  assert.equal("created_by" in calls[0].args,false);
});

test("structured Resume save is one request-scoped atomic RPC",async()=>{
  const{calls,service}=fixture();
  await service.structured(user as any,resumeId,{summary:" Summary ",skills:" SQL, Python ",employment:[{id:"employment-1",company:"Acme",jobTitle:"Engineer",isCurrent:true}],education:[],certifications:[]}as any);
  assert.equal(calls.length,1);assert.equal(calls[0].name,"update_resume_structured_content_v091");
  assert.equal(calls[0].args.p_summary,"Summary");assert.equal(calls[0].args.p_employment[0].company,"Acme");
});

test("database policy failures become safe API errors",async()=>{
  const service=new CandidateService({forUser:()=>({rpc:async()=>({data:null,error:{code:"42501",message:"permission denied for Resume metadata"}})})}as any);
  await assert.rejects(()=>service.get(user as any,resumeId),(error:any)=>error.code==="CANDIDATE_PROFILE_ACCESS_DENIED"&&error.status===403);
});
