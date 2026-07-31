import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {plainToInstance} from "class-transformer";
import {validate} from "class-validator";
import {ResumeAnswerService} from "../src/resume-answers/resume-answer.service.js";
import {SaveResumeAnswerDto} from "../src/resume-answers/resume-answer.dto.js";

const user={id:"user-1",token:"user-jwt",claims:{}},resumeId="123e4567-e89b-42d3-a456-426614174000",answerId="223e4567-e89b-42d3-a456-426614174000";
function fixture(){const calls:any[]=[];const client={rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:[],error:null};}};return{calls,service:new ResumeAnswerService({forUser:(token:string)=>{assert.equal(token,user.token);return client;}}as any)};}

test("Resume answers use the request-scoped user client and allowlisted RPC arguments",async()=>{
 const{calls,service}=fixture();
 await service.list(user as any,resumeId);
 await service.save(user as any,resumeId,{answerKey:"authorized_to_work",questionPatterns:[" legally authorized? "],answerType:"BOOLEAN",answerValue:true,reviewStatus:"VERIFIED",active:true} as any,answerId);
 await service.archive(user as any,resumeId,answerId);
 assert.deepEqual(calls.map(x=>x.name),["list_resume_application_answers_v090","save_resume_application_answer_v090","archive_resume_application_answer_v090"]);
 assert.deepEqual(calls[1].args,{p_resume_id:resumeId,p_answer_id:answerId,p_answer_key:"authorized_to_work",p_question_patterns:["legally authorized?"],p_answer_type:"BOOLEAN",p_answer_value:true,p_review_status:"VERIFIED",p_active:true});
 assert.equal("created_by" in calls[1].args,false);
});

test("Resume answer DTO rejects unknown keys and oversized pattern lists",async()=>{
 const dto=plainToInstance(SaveResumeAnswerDto,{answerKey:"race",questionPatterns:Array(21).fill("question pattern"),answerType:"TEXT",answerValue:"value",reviewStatus:"VERIFIED",active:true});
 const errors=await validate(dto);
 assert.ok(errors.some(error=>error.property==="answerKey"));
 assert.ok(errors.some(error=>error.property==="questionPatterns"));
});

test("Resume answer DTO blocks sensitive patterns and type/value mismatches",async()=>{
 const sensitive=plainToInstance(SaveResumeAnswerDto,{answerKey:"authorized_to_work",questionPatterns:["What is your veteran status?"],answerType:"BOOLEAN",answerValue:true,reviewStatus:"VERIFIED"});
 const mismatched=plainToInstance(SaveResumeAnswerDto,{answerKey:"years_of_experience",questionPatterns:["How many years?"],answerType:"NUMBER",answerValue:"twelve",reviewStatus:"VERIFIED"});
 assert.ok((await validate(sensitive)).some(error=>error.property==="questionPatterns"));
 assert.ok((await validate(mismatched)).some(error=>error.property==="answerValue"));
});

test("database policy failures become safe API errors",async()=>{
 const service=new ResumeAnswerService({forUser:()=>({rpc:async()=>({data:null,error:{code:"42501",message:"permission denied"}})})}as any);
 await assert.rejects(()=>service.list(user as any,resumeId),(error:any)=>error.code==="RESUME_ANSWER_ACCESS_DENIED"&&error.status===403);
});
