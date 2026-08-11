import test from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ResumeService } from "../src/resumes/resume.service.js";
import { ResumeStatusDto } from "../src/resumes/resume-status.dto.js";

const user={id:"123e4567-e89b-42d3-a456-426614174000",token:"jwt",claims:{}};

test("Resume archive DTO accepts only active or archived",async()=>{
  assert.equal((await validate(plainToInstance(ResumeStatusDto,{status:"ARCHIVED"}))).length,0);
  assert.ok((await validate(plainToInstance(ResumeStatusDto,{status:"DELETED"}))).length>0);
});

test("Resume reads default to active and expose archived history only when requested",async()=>{
  const runs:any[][]=[];
  const service=new ResumeService({forUser:(token:string)=>{
    assert.equal(token,"jwt");
    const calls:any[]=[];runs.push(calls);
    const query:any={
      select:()=>query,
      eq:(...args:any[])=>{calls.push(["eq",...args]);return query;},
      order:()=>query,
      range:async()=>({data:[],error:null,count:0}),
    };
    return{from:(table:string)=>{assert.equal(table,"resumes");return query;}};
  }}as any);
  await service.list(user as any,{});
  await service.list(user as any,{status:"ARCHIVED"});
  await service.list(user as any,{status:"ALL"});
  assert.ok(runs[0].some(x=>x[0]==="eq"&&x[1]==="status"&&x[2]==="ACTIVE"));
  assert.ok(runs[1].some(x=>x[0]==="eq"&&x[1]==="status"&&x[2]==="ARCHIVED"));
  assert.equal(runs[2].some(x=>x[0]==="eq"&&x[1]==="status"),false);
});

test("Resume archive mutation uses one caller-scoped protected RPC",async()=>{
  let call:any;
  const service=new ResumeService({forUser:(token:string)=>{assert.equal(token,"jwt");return{rpc:async(name:string,args:any)=>{call={name,args};return{data:{id:args.p_resume_id,status:args.p_status,archived_at:"2026-08-11T00:00:00Z",archived_by:user.id},error:null};}};}}as any);
  const result=await service.status(user as any,"223e4567-e89b-42d3-a456-426614174000","ARCHIVED");
  assert.equal(result.status,"ARCHIVED");
  assert.deepEqual(call,{name:"set_resume_archived_state_v23",args:{p_resume_id:"223e4567-e89b-42d3-a456-426614174000",p_status:"ARCHIVED"}});
});
