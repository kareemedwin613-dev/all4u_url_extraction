import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authStateDecision } from "../src/services/auth-state.js";

const session=(id,token="token")=>({access_token:token,user:{id,email:`${id}@example.com`}});

test("same-user focus and token refresh events do not reset the dashboard",()=>{
  const current=session("user-1","old"),refreshed=session("user-1","new");
  for(const event of ["SIGNED_IN","TOKEN_REFRESHED","INITIAL_SESSION"]){
    assert.deepEqual(authStateDecision(event,current,refreshed),{apply:false,resetAccess:false});
  }
});

test("real authentication changes still reset access",()=>{
  assert.deepEqual(authStateDecision("SIGNED_IN",null,session("user-1")),{apply:true,resetAccess:true});
  assert.deepEqual(authStateDecision("SIGNED_IN",session("user-1"),session("user-2")),{apply:true,resetAccess:true});
  assert.deepEqual(authStateDecision("USER_UPDATED",session("user-1"),session("user-1")),{apply:true,resetAccess:true});
  assert.deepEqual(authStateDecision("SIGNED_OUT",session("user-1"),null),{apply:true,resetAccess:true});
});

test("dashboard auth subscription uses the stability decision before clearing access",async()=>{
  const source=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/authStateDecision\(event, sessionRef\.current, next\)/);
  assert.match(source,/if \(!decision\.apply\) return/);
});
