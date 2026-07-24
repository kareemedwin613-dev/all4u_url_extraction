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
  let call;const client={rpc:async(name,args)=>{call={name,args};return {data:[{id,total_count:26}],error:null};}};
  const result=await listUsers(client,{page:2,pageSize:25,status:"ACTIVE",roleCode:"APPLIER",sort:"email_desc"});
  assert.equal(call.name,"admin_list_users_v2");assert.equal(call.args.p_offset,25);assert.equal(call.args.p_sort,"email_desc");assert.equal(result.totalPages,2);
});

test("admin mutations use secured RPC contracts",async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==="admin_get_user"?{id}:name==="admin_set_user_status"?{id,status:"INACTIVE"}:["ADMIN"],error:null};}};
  assert.equal((await getUser(client,id)).id,id);assert.deepEqual(await assignRole(client,id,"admin"),["ADMIN"]);assert.deepEqual(await removeRole(client,id,"admin"),["ADMIN"]);assert.equal((await setStatus(client,id,"inactive")).status,"INACTIVE");
  assert.deepEqual(calls.map(x=>x[0]),["admin_get_user","admin_assign_role","admin_remove_role","admin_set_user_status"]);
});

test("known database errors are safe and actionable",()=>{
  assert.equal(normalizeAccessError(new Error("LAST_ACTIVE_ADMIN_REQUIRED: detail")).code,"LAST_ACTIVE_ADMIN_REQUIRED");
  assert.equal(normalizeAccessError({code:"42501",message:"internal policy"}).code,"ACCESS_DENIED");
  assert.equal(normalizeAccessError(new Error("USER_NOT_FOUND")).message,"The selected user no longer exists.");
});
