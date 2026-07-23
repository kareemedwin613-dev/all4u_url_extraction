import test from "node:test";
import assert from "node:assert/strict";
import {accessState,normalizeAccessContext} from "../src/access/access-context.js";
import {getMyAccessContext} from "../src/services/access-service.js";

const id="f3a34ffd-d66a-49f7-815e-c7786857576b";
test("normalizes one role, multiple roles, duplicates, and no-role state",()=>{
  const one=normalizeAccessContext({userId:id,email:"USER@EXAMPLE.TEST",fullName:" User ",status:"ACTIVE",roles:["applier"]});
  assert.equal(one.email,"user@example.test");assert.equal(one.fullName,"User");assert.deepEqual(one.roles,["APPLIER"]);assert.equal(accessState(one),"ACTIVE_WITH_ROLES");
  const multiple=normalizeAccessContext({user_id:id,status:"ACTIVE",role_codes:["developer","APPLIER","developer"]});
  assert.deepEqual(multiple.roles,["APPLIER","DEVELOPER"]);
  assert.equal(accessState(normalizeAccessContext({userId:id,status:"ACTIVE",roles:[]})),"PENDING_ACCESS");
  assert.equal(accessState(normalizeAccessContext({userId:id,status:"INACTIVE",roles:["ADMIN"]})),"ACCOUNT_INACTIVE");
});

test("rejects missing profiles and malformed RPC responses",()=>{
  assert.throws(()=>normalizeAccessContext(null),{code:"ACCESS_CONTEXT_FAILED"});
  assert.throws(()=>normalizeAccessContext({userId:"bad",status:"ACTIVE",roles:[]}),{code:"ACCESS_CONTEXT_FAILED"});
});

test("access service distinguishes network failure from no roles",async()=>{
  const client={rpc:async()=>({data:null,error:new Error("network fetch failed")})};
  await assert.rejects(()=>getMyAccessContext(client),{code:"NETWORK_ERROR",retryable:true});
});
