import test from "node:test";
import assert from "node:assert/strict";
import {navigate, parseRoute} from "../src/router.js";
import {guardAccessRoute, navigationForAccess} from "../src/access/route-access.js";
import {capabilitiesForRoles} from "../src/access/capabilities.js";
import {readFileSync} from "node:fs";
const access = role => ({status:"ACTIVE",roles:[role],capabilities:capabilitiesForRoles([role])});
test("bulk JD review routes are revisitable and manager-only",()=>{
  assert.equal(parseRoute("#/jd-review-batches").name,"jd-review-batches");
  const route=parseRoute("#/jd-review-batches/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(route.name,"jd-review-batch-detail");
  assert.equal(guardAccessRoute(route,{},access("JD_FINDER")),"#/access-denied");
  assert.equal(guardAccessRoute(route,{},access("APPLYING_MANAGER")),null);
  assert.ok(navigationForAccess(access("ADMIN")).some(x=>x.name==="jd-review-batches"));
  assert.equal(parseRoute("#/jd-review-batches/not-uuid").name,"invalid-id");
});
test("review UI includes progress, resume command, diagnostics and before/after history",()=>{
  const source=readFileSync(new URL("../src/features/jd-review/jd-review-pages.jsx",import.meta.url),"utf8");
  for(const text of ["Create / resume runner command","Retry failed items","AI reviewed","FAILED","fieldChanges","clearInterval","jd-review:run"]) assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/localStorage|sessionStorage/); // Never persist runner credentials in browser storage.
  assert.match(source,/Create classification batch from these JDs/);
  assert.match(source,/no website visits, expiration checks or new blocking decisions/);
  assert.match(source,/legacy \|\| data.batch.cancelled/);
  assert.match(source,/jd-classify-v4/);
  assert.match(source,/No second manual approval is required/);
  assert.match(source,/Not completed \(legacy\)/);
  assert.doesNotMatch(source,/Needs attention|Needs Correction|need attention|Retry attention/);
});
test("JD batch creation imports navigation and opens the created batch route", t=>{
  const source=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
  const routerImports=source.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\/router\.js["']/)?.[1].split(",").map(x=>x.trim());
  assert.ok(routerImports?.includes("navigate"),"The batch creation handler must import navigate.");
  const previous=Object.getOwnPropertyDescriptor(globalThis,"location"), calls=[];
  Object.defineProperty(globalThis,"location",{configurable:true,value:{assign:path=>calls.push(path)}});
  t.after(()=>previous ? Object.defineProperty(globalThis,"location",previous) : delete globalThis.location);
  const id="123e4567-e89b-42d3-a456-426614174000";
  navigate(`#/jd-review-batches/${id}`);
  assert.deepEqual(calls,[`#/jd-review-batches/${id}`]);
  assert.equal(parseRoute(calls[0]).name,"jd-review-batch-detail");
});
