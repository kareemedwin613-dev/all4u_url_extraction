import test from "node:test";
import assert from "node:assert/strict";
import {assignRole,getUser,listUsers,normalizeAccessError,normalizeListOptions,removeRole,setStatus} from "../src/services/admin-user-service.js";

const id="f3a34ffd-d66a-49f7-815e-c7786857576b";
test("admin list input is bounded and calculates server offset",()=>{
  assert.deepEqual(normalizeListOptions({search:" x ",status:"active",roleCode:"admin",sort:"name_asc",page:3,pageSize:50}),{search:"x",status:"ACTIVE",roleCode:"ADMIN",sort:"name_asc",page:3,pageSize:50,offset:100});
  assert.equal(normalizeListOptions({page:-2,pageSize:999}).pageSize,25);
  assert.equal(normalizeListOptions({sort:"unsafe"}).sort,"created_desc");
});

test("admin list sends normalized filters and returns pagination",async()=>{
  let call;const originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");}};globalThis.fetch=async(url,options)=>{call={url:new URL(url),options};return new Response(JSON.stringify({data:{items:[{id}],page:2,pageSize:25,total:26,totalPages:2}}),{status:200});};
  try{const result=await listUsers(client,"https://api.example.com",{page:2,pageSize:25,status:"ACTIVE",roleCode:"APPLIER",sort:"email_desc"});assert.equal(call.url.pathname,"/api/v1/admin/users");assert.equal(call.url.searchParams.get("page"),"2");assert.equal(call.url.searchParams.get("sort"),"email_desc");assert.equal(result.totalPages,2);}finally{globalThis.fetch=originalFetch;}
});

test("admin mutations use secured API contracts",async()=>{
  const calls=[],originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");}};globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});const path=new URL(url).pathname,data=path.endsWith("/status")?{id,status:"INACTIVE"}:path.includes("/roles")?["ADMIN"]:{id};return new Response(JSON.stringify({data}),{status:200});};
  try{const base="https://api.example.com";assert.equal((await getUser(client,base,id)).id,id);assert.deepEqual(await assignRole(client,base,id,"admin"),["ADMIN"]);assert.deepEqual(await removeRole(client,base,id,"admin"),["ADMIN"]);assert.equal((await setStatus(client,base,id,"inactive")).status,"INACTIVE");}finally{globalThis.fetch=originalFetch;}
  assert.deepEqual(calls.map(x=>x.options.method||"GET"),["GET","POST","DELETE","PATCH"]);
});

test("known database errors are safe and actionable",()=>{
  assert.equal(normalizeAccessError(new Error("LAST_ACTIVE_ADMIN_REQUIRED: detail")).code,"LAST_ACTIVE_ADMIN_REQUIRED");
  assert.equal(normalizeAccessError({code:"42501",message:"internal policy"}).code,"ACCESS_DENIED");
  assert.equal(normalizeAccessError(new Error("USER_NOT_FOUND")).message,"The selected user no longer exists.");
});
