import test from "node:test";
import assert from "node:assert/strict";
import {guardRoute,parseRoute} from "../src/router.js";
const id="f3a34ffd-d66a-49f7-815e-c7786857576b";
test("parses dashboard routes",()=>{
  assert.equal(parseRoute("#/").name,"overview");
  assert.equal(parseRoute("#/login").name,"login");
  assert.equal(parseRoute("#/profile").name,"profile");
  assert.equal(parseRoute("#/pending-access").name,"pending-access");
  assert.equal(parseRoute("#/account-inactive").name,"account-inactive");
  assert.equal(parseRoute("#/access-denied").name,"access-denied");
  assert.equal(parseRoute("#/applications").name,"applications");
  assert.equal(parseRoute("#/applications/new").name,"application-new");
  assert.equal(parseRoute("#/applications/bulk-create").name,"application-bulk-create");
  assert.equal(parseRoute("#/applications/"+id).name,"application-detail");
  assert.equal(parseRoute("#/application-batches").name,"application-batches");
  assert.equal(parseRoute("#/application-batches/"+id).name,"application-batch-detail");
  assert.equal(parseRoute("#/tailoring-jobs").name,"tailoring-jobs");
  assert.deepEqual(parseRoute("#/tailoring-jobs/"+id).id,id);
  assert.equal(parseRoute("#/users").name,"users-directory");
  assert.equal(parseRoute("#/jobs").name,"jobs");
  assert.deepEqual(parseRoute("#/jobs/"+id).id,id);
  assert.equal(parseRoute("#/resumes").name,"resumes");
  assert.equal(parseRoute("#/resumes/upload").name,"resume-upload");
  assert.deepEqual(parseRoute("#/resumes/"+id+"/autofill"),{
    name:"candidate-profile",
    path:"/resumes/"+id+"/autofill",
    id,
    query:""
  });
  assert.deepEqual(parseRoute("#/resumes/"+id).id,id);
  assert.equal(parseRoute("#/admin/users").name,"admin-users");
  assert.equal(parseRoute("#/admin/users/"+id).name,"admin-user-detail");
  assert.equal(parseRoute("#/admin/roles").name,"admin-roles");
});
test("rejects invalid ids and unknown routes",()=>{assert.equal(parseRoute("#/applications/nope").name,"invalid-id");assert.equal(parseRoute("#/jobs/nope").name,"invalid-id");assert.equal(parseRoute("#/tailoring-jobs/nope").name,"invalid-id");assert.equal(parseRoute("#/unknown").name,"not-found");});
test("preserves hash query",()=>assert.equal(parseRoute("#/applications?page=2&workStatus=BLOCKED").query,"page=2&workStatus=BLOCKED"));
test("guards authentication",()=>{assert.equal(guardRoute(parseRoute("#/applications"),null),"#/login");assert.equal(guardRoute(parseRoute("#/login"),{user:{}}),"#/");assert.equal(guardRoute(parseRoute("#/applications"),{user:{}}),null);});
