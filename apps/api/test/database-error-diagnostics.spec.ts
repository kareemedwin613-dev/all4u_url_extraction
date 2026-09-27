import assert from"node:assert/strict";
import test from"node:test";
import{TailoringService}from"../src/platform/platform.service.js";
import{ApiException}from"../src/common/errors/api.exception.js";
import{ApiExceptionFilter}from"../src/common/errors/api-exception.filter.js";

const dbError={code:"57014",message:"canceling statement due to statement timeout",details:null,hint:null};
const query:any={select:()=>query,order:()=>query,limit:()=>query,eq:()=>query,then:(resolve:any)=>resolve({data:null,error:dbError})};
const service=new TailoringService({forUser:()=>({from:()=>query})}as any);

test("a failed tailoring queue query keeps the database error for server logs only",async()=>{
  const error:any=await service.list({id:"u",token:"t"}as any,"ALL").catch(value=>value);
  assert.ok(error instanceof ApiException);
  assert.equal(error.getStatus(),502);
  assert.equal(error.message,"The tailoring queue could not be loaded.");
  assert.deepEqual(error.diagnostic,dbError);
  let body:any;
  const host:any={switchToHttp:()=>({getRequest:()=>({requestId:"req_1",method:"GET",path:"/api/v1/tailoring-jobs"}),getResponse:()=>({status:()=>({json:(value:any)=>{body=value;}})})})};
  new ApiExceptionFilter().catch(error,host);
  assert.deepEqual(body,{code:"DATABASE_ERROR",message:"The tailoring queue could not be loaded.",requestId:"req_1"});
});
