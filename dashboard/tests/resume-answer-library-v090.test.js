import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import{archiveResumeAnswer,createResumeAnswer,listResumeAnswers,updateResumeAnswer}from"../src/features/resume-answers/resume-answer-service.js";

const resumeId="123e4567-e89b-42d3-a456-426614174000",answerId="223e4567-e89b-42d3-a456-426614174000";
const client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})}};

test("Resume Answer Library uses authenticated backend CRUD routes only",async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});};
 try{await listResumeAnswers(client,"https://api.example.com",resumeId);await createResumeAnswer(client,"https://api.example.com",resumeId,{answerKey:"authorized_to_work"});await updateResumeAnswer(client,"https://api.example.com",resumeId,answerId,{active:false});await archiveResumeAnswer(client,"https://api.example.com",resumeId,answerId);}finally{globalThis.fetch=original;}
 assert.deepEqual(calls.map(({url,options})=>[new URL(url).pathname,options.method]),[[`/api/v1/resumes/${resumeId}/application-answers`,`GET`],[`/api/v1/resumes/${resumeId}/application-answers`,`POST`],[`/api/v1/resumes/${resumeId}/application-answers/${answerId}`,`PATCH`],[`/api/v1/resumes/${resumeId}/application-answers/${answerId}`,`DELETE`]]);
 assert.ok(calls.every(({options})=>options.headers.Authorization==="Bearer token"));
});

test("Resume detail exposes the Ant Design library only to Application managers",async()=>{
 const [app,view]=await Promise.all([readFile(new URL("../src/App.jsx",import.meta.url),"utf8"),readFile(new URL("../src/features/resume-answers/resume-answer-library.jsx",import.meta.url),"utf8")]);
 assert.match(app,/hasCapability\(access,CAPABILITIES\.APPLICATION_MANAGE\)/);
 assert.match(app,/ResumeAnswerLibrary/);
 assert.match(view,/Table/);assert.match(view,/Modal/);assert.match(view,/Popconfirm/);assert.match(view,/Never add demographic/);
 assert.match(view,/authorized_to_work/);assert.match(view,/remote_work_preference/);
});
