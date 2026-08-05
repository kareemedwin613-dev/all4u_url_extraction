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
  assert.equal(guardAccessRoute(parseRoute("#/jobs"),session,access(["JD_FINDER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/admin/users"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/admin/users"),session,access(["ADMIN"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/applications"),session,access(["APPLIER"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/applications/new"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/applications/new"),session,access(["APPLYING_MANAGER"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/applications/bulk-create"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/applications/bulk-create"),session,access(["APPLYING_MANAGER"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/application-batches"),session,access(["ADMIN"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/application-batches"),session,access(["DEVELOPER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/tailoring-jobs"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/tailoring-jobs/"+id),session,access(["APPLYING_MANAGER"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/tailoring-jobs/"+id),session,access(["ADMIN"])),null);
  assert.equal(guardAccessRoute(parseRoute("#/applications"),session,access(["DEVELOPER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/resumes/upload"),session,access(["APPLIER"])),"#/access-denied");
  assert.equal(guardAccessRoute(parseRoute("#/resumes/upload"),session,access(["ADMIN"])),null);
});

test("navigation is exact for technical, business, admin, and multi-role users",()=>{
  assert.deepEqual(navigationForAccess(access(["DEVELOPER"])).map(x=>x.label),["Overview","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["JD_FINDER"])).map(x=>x.label),["Overview","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["APPLIER"])).map(x=>x.label),["Overview","Applications","Job Descriptions","Resumes","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["APPLIER","DEVELOPER"])).map(x=>x.label),["Overview","Applications","Job Descriptions","Resumes","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["APPLYING_MANAGER"])).map(x=>x.label),["Overview","Applications","Application Batches","Assignment Batches","Applier Workloads","Tailoring Reviews","Tailoring Batches","Job Descriptions","Resumes","Users","My Profile"]);
  assert.deepEqual(navigationForAccess(access(["ADMIN"])).map(x=>x.label),["Overview","Applications","Application Batches","Assignment Batches","Applier Workloads","Tailoring Reviews","Tailoring Batches","Job Descriptions","Resumes","Upload Resume","Users","Roles","My Profile"]);
});
