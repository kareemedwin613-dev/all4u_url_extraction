import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { JobDescriptionStatusDto } from "../src/job-descriptions/job-description-status.dto.js";
import { JobDescriptionReviewDto } from "../src/job-descriptions/job-description-review.dto.js";
import { JobDescriptionCorrectionDto } from "../src/job-descriptions/job-description-correction.dto.js";
import { JobDescriptionReadService } from "../src/job-descriptions/job-description-read.service.js";

test("captured URL review DTO allowlists statuses and decline reasons",async()=>{
  assert.equal((await validate(plainToInstance(JobDescriptionStatusDto,{status:"ARCHIVED",reason:"NOT_APPLICABLE"}))).length,0);
  assert.ok((await validate(plainToInstance(JobDescriptionStatusDto,{status:"DELETED",reason:"FREE_TEXT"}))).length>=2);
});

test("simple JD review DTO allowlists four decisions and fixed decline reasons",async()=>{
  assert.equal((await validate(plainToInstance(JobDescriptionReviewDto,{reviewStatus:"APPROVED"}))).length,0);
  assert.equal((await validate(plainToInstance(JobDescriptionReviewDto,{reviewStatus:"DECLINED",declineReason:"EXPIRED",comment:"Closed"}))).length,0);
  assert.ok((await validate(plainToInstance(JobDescriptionReviewDto,{reviewStatus:"UNDER_REVIEW"}))).length);
});

test("JD Finder correction DTO validates editable capture fields",async()=>{
  const valid={company:"Example",jobTitle:"Engineer",categoryId:"123e4567-e89b-42d3-a456-426614174000",sourceUrl:"https://example.com/jobs/1",descriptionText:"A".repeat(100),detectedSkills:["TypeScript"]};
  assert.equal((await validate(plainToInstance(JobDescriptionCorrectionDto,valid))).length,0);
  assert.ok((await validate(plainToInstance(JobDescriptionCorrectionDto,{...valid,sourceUrl:"not-a-url"}))).length);
});

test("captured URL review remains caller scoped and uses the protected RPC",async()=>{
  let call:any;
  const service=new JobDescriptionReadService({forUser:(token:string)=>{assert.equal(token,"manager-jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:args.p_job_description_id,status:args.p_status,archive_reason:args.p_reason},error:null};}};}}as any);
  const result:any=await service.status({id:"manager",token:"manager-jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000","ARCHIVED","NOT_APPLICABLE");
  assert.equal(call.name,"set_job_description_archived_state_v24");
  assert.equal(result.status,"ARCHIVED");
  assert.equal(call.args.p_reason,"NOT_APPLICABLE");
});

test("simple review uses the v2.7 protected RPC",async()=>{
  let call:any;
  const service=new JobDescriptionReadService({forUser:()=>({rpc:async(name:string,args:any)=>{call={name,args};return{data:{review_status:args.p_review_status},error:null};}})}as any);
  const result:any=await service.review({id:"manager",token:"jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000","NEEDS_CORRECTION",undefined,"Fix company");
  assert.equal(call.name,"review_job_description_v27");
  assert.equal(call.args.p_comment,"Fix company");
  assert.equal(result.review_status,"NEEDS_CORRECTION");
});

test("JD Finder correction uses the caller-scoped v3.1 RPC",async()=>{
  let call:any;
  const service=new JobDescriptionReadService({forUser:(token:string)=>{assert.equal(token,"finder-jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:args.p_job_description_id,company:args.p_company,review_status:"NEEDS_REVIEW"},error:null};}};}}as any);
  const result:any=await service.correct({id:"finder",token:"finder-jwt",claims:{}} as any,"123e4567-e89b-42d3-a456-426614174000",{company:" Example ",jobTitle:"Engineer",categoryId:"123e4567-e89b-42d3-a456-426614174000",sourceUrl:"https://example.com/jobs/1?utm_source=test",descriptionText:"A".repeat(100)} as any);
  assert.equal(call.name,"update_my_job_description_v31");
  assert.equal(call.args.p_normalized_source_url,"https://example.com/jobs/1");
  assert.equal(result.review_status,"NEEDS_REVIEW");
});

test("manager edit uses the v3.12 protected RPC for any unapproved JD",async()=>{
  let call:any;
  const service=new JobDescriptionReadService({forUser:(token:string)=>{assert.equal(token,"manager-jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:args.p_job_description_id,company:args.p_company,review_status:"NEEDS_REVIEW"},error:null};}};}}as any);
  const result:any=await service.managerEdit({id:"manager",token:"manager-jwt",claims:{}} as any,"123e4567-e89b-42d3-a456-426614174000",{company:"Acme",jobTitle:"Engineer",categoryId:"123e4567-e89b-42d3-a456-426614174000",sourceUrl:"https://example.com/jobs/2",descriptionText:"B".repeat(100)} as any);
  assert.equal(call.name,"manager_update_job_description_v312");
  assert.equal(call.args.p_company,"Acme");
  assert.equal(result.review_status,"NEEDS_REVIEW");
});
