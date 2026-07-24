import test from "node:test";
import assert from "node:assert/strict";
import {applicationActions,validateApplicationCreate,validateApplicationProgress} from "../src/features/applications/validation.js";
import {parseApplicationQuery,serializeApplicationQuery} from "../src/features/applications/query-state.js";
import {createApplication,listApplications,normalizeApplicationError,openApplicationResume,reassignApplication,updateApplication} from "../src/features/applications/application-service.js";
import {capabilitiesForRoles} from "../src/access/capabilities.js";
import {readFile} from "node:fs/promises";

const id="f3a34ffd-d66a-49f7-815e-c7786857576b",id2="b4d63a80-e306-4a2f-afca-29cd4b3951e0";
const access=(roles,userId=id)=>({roles,userId,status:"ACTIVE",capabilities:capabilitiesForRoles(roles)});

test("application validation accepts a valid create and rejects unsafe fields",()=>{
  assert.equal(validateApplicationCreate({jobDescriptionId:id,resumeId:id2,priority:"NORMAL"}).valid,true);
  assert.equal(validateApplicationCreate({priority:"WRONG"}).valid,false);
  assert.equal(validateApplicationProgress({workStatus:"IN_PROGRESS",applicationStatus:"APPLIED",applicationUrl:"https://example.test/app"}).valid,true);
  assert.equal(validateApplicationProgress({workStatus:"WRONG",applicationStatus:"APPLIED",applicationUrl:"javascript:alert(1)"}).valid,false);
});

test("application action visibility follows roles and assignment",()=>{
  assert.deepEqual(applicationActions(access(["DEVELOPER"]),{assigned_to:id}),{canCreate:false,canReassign:false,canManageFields:false,canUpdate:false,canOpenResume:false,canDelete:false});
  assert.equal(applicationActions(access(["APPLIER"]),{assigned_to:id}).canUpdate,true);
  assert.equal(applicationActions(access(["APPLIER"]),{assigned_to:id2}).canUpdate,false);
  assert.equal(applicationActions(access(["APPLYING_MANAGER"]),{assigned_to:id2}).canReassign,true);
  assert.equal(applicationActions(access(["ADMIN"]),{assigned_to:null}).canCreate,true);
});

test("application query state is allowlisted and serializable",()=>{
  const value=parseApplicationQuery("page=2&pageSize=50&workStatus=BLOCKED&priority=URGENT&sort=due_asc&search=Acme");
  assert.equal(value.page,2);assert.equal(value.priority,"URGENT");assert.equal(value.sort,"due_asc");
  assert.match(serializeApplicationQuery(value),/workStatus=BLOCKED/);
  assert.equal(parseApplicationQuery("workStatus=INJECTED&sort=bad").workStatus,"");
});

test("application services use protected RPC contracts",async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push([name,args]);if(name==="list_applications")return {data:{items:[{id}],total:1},error:null};if(name==="create_application")return {data:{id},error:null};return {data:{id},error:null};}};
  const list=await listApplications(client,{page:1,pageSize:25,search:"",sort:"updated_desc"});
  assert.equal(list.total,1);
  await createApplication(client,{jobDescriptionId:id,resumeId:id2,priority:"HIGH"});
  await updateApplication(client,id,{workStatus:"IN_PROGRESS",applicationStatus:"NOT_APPLIED",priority:"HIGH"});
  await updateApplication(client,id,{workStatus:"IN_PROGRESS",applicationStatus:"APPLIED",applicationUrl:"https://jobs.example.test/application"});
  await reassignApplication(client,id,id2,"Capacity");
  assert.deepEqual(calls.map(x=>x[0]),["list_applications","create_application","update_application_progress","update_application_progress","reassign_application"]);
  assert.equal(calls[0][1].p_limit,25);
  assert.equal(calls[3][1].p_priority,null);assert.equal(calls[3][1].p_due_at,null);assert.equal(calls[3][1].p_applied_at,null);assert.equal(calls[3][1].p_notes,null);
});

test("private resume flow authorizes by Application before signing",async()=>{
  const calls=[],client={rpc:async(name)=>{calls.push(name);return {data:{bucket:"original-resumes",path:id+"/resume.pdf"},error:null};},storage:{from:bucket=>({createSignedUrl:async(path,seconds)=>{calls.push([bucket,path,seconds]);return {data:{signedUrl:"https://signed.test"},error:null};}})}};
  assert.equal(await openApplicationResume(client,id),"https://signed.test");
  assert.deepEqual(calls[0],"get_application_resume_file");
  assert.equal(calls[1][2],90);
});

test("database errors become user-friendly application messages",()=>{
  assert.equal(normalizeApplicationError(new Error("APPLICATION_DUPLICATE: internal")).code,"APPLICATION_DUPLICATE");
  assert.equal(normalizeApplicationError({code:"42501",message:"policy"}).message,"You do not have permission to perform this action.");
});

test("Application pages expose list, create, detail, history, and empty/loading states",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  for(const text of ["ApplicationsPage","CreateApplicationPage","ApplicationDetailPage","Create Application","Assignment History","Status History","No Applications","Loading..."])assert.match(source,new RegExp(text));
});

test("Applier Application columns follow the operational priority order",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  const section=source.slice(source.indexOf("const applierColumns="),source.indexOf("const columns=manager?"));
  const labels=["Company","Job title","Resume","Link","Status","Captured at","Primary category"];
  let position=-1;
  for(const label of labels){const next=section.indexOf(`title:\"${label}\"`);assert.ok(next>position,`${label} follows the requested order`);position=next;}
  assert.match(section,/source_url/);
  assert.match(section,/application_url/);
  assert.ok(section.indexOf('title:"Application #"')<section.indexOf('title:"Company"'));
});

test("manager Application list identifies both sides of the JD and Resume pair",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  const section=source.slice(source.indexOf("const managerColumns="),source.indexOf("const applierColumns="));
  for(const field of ["company","job_title","resume_name","candidate_name","assignee_name"])assert.match(section,new RegExp(field));
  assert.match(section,/numberColumn/);
});

test("Application number is visible on the list, detail heading, and search",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  assert.match(source,/Application #/);
  assert.match(source,/Application number/);
  assert.match(source,/Application #, company, or job title/);
});
