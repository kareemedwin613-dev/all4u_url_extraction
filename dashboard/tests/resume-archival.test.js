import test from "node:test";
import assert from "node:assert/strict";
import { listResumes, setResumeStatus } from "../src/services/resume-read-service.js";

const client={auth:{getSession:async()=>({data:{session:{access_token:"dashboard-token"}},error:null})}};

test("Resume list defaults and explicit history filters travel through the backend",async()=>{
  const calls=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({data:{items:[]}}),{status:200,headers:{"content-type":"application/json"}});};
  try{
    await listResumes(client,"https://api.example.com",{status:"ACTIVE",page:1,pageSize:25});
    await listResumes(client,"https://api.example.com",{status:"ARCHIVED",page:1,pageSize:25});
  }finally{globalThis.fetch=originalFetch;}
  assert.equal(new URL(calls[0].url).searchParams.get("status"),"ACTIVE");
  assert.equal(new URL(calls[1].url).searchParams.get("status"),"ARCHIVED");
  assert.equal(calls[0].options.headers.Authorization,"Bearer dashboard-token");
});

test("archive and restore use the authenticated Resume status endpoint",async()=>{
  let request;const originalFetch=globalThis.fetch,id="123e4567-e89b-42d3-a456-426614174000";
  globalThis.fetch=async(url,options)=>{request={url:String(url),options};return new Response(JSON.stringify({data:{id,status:"ARCHIVED"}}),{status:200,headers:{"content-type":"application/json"}});};
  try{assert.equal((await setResumeStatus(client,"https://api.example.com",id,"ARCHIVED")).status,"ARCHIVED");}finally{globalThis.fetch=originalFetch;}
  assert.equal(new URL(request.url).pathname,`/api/v1/resumes/${id}/status`);
  assert.equal(request.options.method,"PATCH");
  assert.deepEqual(JSON.parse(request.options.body),{status:"ARCHIVED"});
});
