import test from "node:test";
import assert from "node:assert/strict";
import {capturedDateBounds,listJobs} from "../src/services/job-read-service.js";

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

test("JD captured windows use local calendar boundaries and custom ranges are inclusive",()=>{
  const now=new Date(2026,7,11,15,30),today=capturedDateBounds({capturedWindow:"TODAY"},now),week=capturedDateBounds({capturedWindow:"THIS_WEEK"},now),month=capturedDateBounds({capturedWindow:"THIS_MONTH"},now),custom=capturedDateBounds({capturedWindow:"CUSTOM",capturedFrom:"2026-08-02",capturedTo:"2026-08-05"},now);
  assert.equal(new Date(today.capturedFrom).getDate(),11);assert.equal(new Date(today.capturedTo).getDate(),12);
  assert.equal(new Date(week.capturedFrom).getDay(),1);assert.equal((new Date(week.capturedTo)-new Date(week.capturedFrom))/(24*60*60*1000),7);
  assert.equal(new Date(month.capturedFrom).getDate(),1);assert.equal(new Date(month.capturedTo).getMonth(),8);
  assert.equal(new Date(custom.capturedFrom).getDate(),2);assert.equal(new Date(custom.capturedTo).getDate(),6);
});
