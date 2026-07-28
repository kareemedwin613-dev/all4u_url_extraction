import test from "node:test";
import assert from "node:assert/strict";
import {listJobs} from "../src/services/job-read-service.js";

test("JD list sends bearer-authenticated search, filters, sorting, and pagination to the backend",async()=>{
  let request;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:{items:[],total:0,page:1,pageSize:25,pageCount:0,from:0,to:0,hasPrevious:false,hasNext:false}}),{status:200,headers:{"content-type":"application/json"}});};
  const client={auth:{getSession:async()=>({data:{session:{access_token:"dashboard-token"}},error:null})},from:()=>{throw new Error("Direct JD table read attempted");}};
  const categoryId="b4d63a80-e306-4a2f-afca-29cd4b3951e0";
  try{
    const result=await listJobs(client,"https://api.example.com",{search:"data",categoryId,seniority:"SENIOR",status:"ACTIVE",sort:"company_asc",page:1,pageSize:25});
    const url=new URL(request.url);
    assert.equal(url.pathname,"/api/v1/job-descriptions");
    assert.deepEqual(Object.fromEntries(url.searchParams),{search:"data",categoryId,seniority:"SENIOR",status:"ACTIVE",sort:"company_asc",page:"1",pageSize:"25"});
    assert.equal(request.options.headers.Authorization,"Bearer dashboard-token");
    assert.equal(result.total,0);
  }finally{globalThis.fetch=originalFetch;}
});
