import test from "node:test";
import assert from "node:assert/strict";
import{createCandidateEducation,createCandidateEmployment,getCandidateProfile,importCandidateEmployment,updateCandidateProfile}from"../src/features/candidates/candidate-profile-service.js";
const id="123e4567-e89b-42d3-a456-426614174000",client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})}};

test("Candidate Profile dashboard traffic goes only through authenticated backend endpoints",async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:{id}}),{status:200,headers:{"content-type":"application/json"}});};
 try{await getCandidateProfile(client,"https://api.example.com",id);await importCandidateEmployment(client,"https://api.example.com",id);await updateCandidateProfile(client,"https://api.example.com",id,{fullName:"Jordan",reviewStatus:"NEEDS_REVIEW"});await createCandidateEmployment(client,"https://api.example.com",id,{company:"Acme",jobTitle:"Engineer",isCurrent:false});await createCandidateEducation(client,"https://api.example.com",id,{institution:"University"});}finally{globalThis.fetch=original;}
 assert.deepEqual(calls.map(x=>[new URL(x.url).pathname,x.options.method]),[[`/api/v1/resumes/${id}/autofill-profile`,`GET`],[`/api/v1/resumes/${id}/autofill-employment/import`,`POST`],[`/api/v1/resumes/${id}/autofill-profile`,`PATCH`],[`/api/v1/resumes/${id}/autofill-employment`,`POST`],[`/api/v1/resumes/${id}/autofill-education`,`POST`]]);
 assert.ok(calls.every(x=>x.options.headers.Authorization==="Bearer token"));
});
