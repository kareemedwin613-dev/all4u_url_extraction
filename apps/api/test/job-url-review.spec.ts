import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { JobDescriptionStatusDto } from "../src/job-descriptions/job-description-status.dto.js";
import { JobDescriptionReadService } from "../src/job-descriptions/job-description-read.service.js";

test("captured URL review DTO allowlists statuses and decline reasons",async()=>{
  assert.equal((await validate(plainToInstance(JobDescriptionStatusDto,{status:"ARCHIVED",reason:"NOT_APPLICABLE"}))).length,0);
  assert.ok((await validate(plainToInstance(JobDescriptionStatusDto,{status:"DELETED",reason:"FREE_TEXT"}))).length>=2);
});

test("captured URL review remains caller scoped and uses the protected RPC",async()=>{
  let call:any;
  const service=new JobDescriptionReadService({forUser:(token:string)=>{assert.equal(token,"manager-jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:args.p_job_description_id,status:args.p_status,archive_reason:args.p_reason},error:null};}};}}as any);
  const result:any=await service.status({id:"manager",token:"manager-jwt",claims:{}},"123e4567-e89b-42d3-a456-426614174000","ARCHIVED","NOT_APPLICABLE");
  assert.equal(call.name,"set_job_description_archived_state_v24");
  assert.equal(result.status,"ARCHIVED");
  assert.equal(call.args.p_reason,"NOT_APPLICABLE");
});
