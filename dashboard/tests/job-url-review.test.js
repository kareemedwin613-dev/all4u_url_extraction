import test from "node:test";
import assert from "node:assert/strict";
import { listJobs, setJobStatus } from "../src/services/job-read-service.js";

const client={auth:{getSession:async()=>({data:{session:{access_token:"dashboard-token"}},error:null})}};

test("job URL review defaults to active and can explicitly load archive history",async()=>{
  const calls=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url)=>{calls.push(String(url));return new Response(JSON.stringify({data:{items:[]}}),{status:200,headers:{"content-type":"application/json"}});};
  try{await listJobs(client,"https://api.example.com",{status:"ACTIVE"});await listJobs(client,"https://api.example.com",{status:"ARCHIVED"});}finally{globalThis.fetch=originalFetch;}
  assert.equal(new URL(calls[0]).searchParams.get("status"),"ACTIVE");
  assert.equal(new URL(calls[1]).searchParams.get("status"),"ARCHIVED");
});

test("declining a URL uses the protected backend review endpoint",async()=>{
  let request;const originalFetch=globalThis.fetch,id="123e4567-e89b-42d3-a456-426614174000";
  globalThis.fetch=async(url,options)=>{request={url:String(url),options};return new Response(JSON.stringify({data:{id,status:"ARCHIVED",archive_reason:"NOT_APPLICABLE"}}),{status:200,headers:{"content-type":"application/json"}});};
  try{assert.equal((await setJobStatus(client,"https://api.example.com",id,"ARCHIVED","NOT_APPLICABLE")).status,"ARCHIVED");}finally{globalThis.fetch=originalFetch;}
  assert.equal(new URL(request.url).pathname,`/api/v1/job-descriptions/${id}/status`);
  assert.equal(request.options.method,"PATCH");
  assert.deepEqual(JSON.parse(request.options.body),{status:"ARCHIVED",reason:"NOT_APPLICABLE"});
});
