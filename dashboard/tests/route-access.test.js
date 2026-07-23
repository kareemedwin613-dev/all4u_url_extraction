import test from "node:test";
import assert from "node:assert/strict";
import {normalizeAccessContext} from "../src/access/access-context.js";
import {guardAccessRoute,navigationForAccess} from "../src/access/route-access.js";
import {parseRoute} from "../src/router.js";

const id="f3a34ffd-d66a-49f7-815e-c7786857576b",session={user:{id}},access=roles=>normalizeAccessContext({userId:id,email:"u@example.test",status:"ACTIVE",roles});
test("route guard handles signed-out pending and inactive states",()=>{
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),null,null),"#/login");
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),session,access([])),"#/pending-access");
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),session,normalizeAccessContext({userId:id,status:"INACTIVE",roles:["ADMIN"]})),"#/account-inactive");
});

test("direct business and admin routes are capability protected",()=>{
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),session,access(["APPLIER"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),session,access(["DEVELOPER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/admin/users"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/admin/users"),session,access(["ADMIN"])),null);
});

test("navigation is exact for technical, business, admin, and multi-role users",()=>{
  assert.deepEqual(navigationForAccess(access(["DEVELOPER"])).map(x=>x.label),["Overview","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["APPLIER"])).map(x=>x.label),["Overview","Job Descriptions","Resumes","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["APPLIER","DEVELOPER"])).map(x=>x.label),["Overview","Job Descriptions","Resumes","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["ADMIN"])).map(x=>x.label),["Overview","Job Descriptions","Resumes","Users","Roles","My Profile"]);
});
