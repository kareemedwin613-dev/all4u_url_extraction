import test from "node:test";
import assert from "node:assert/strict";
import {applicationActions,validateApplicationCreate,validateApplicationProgress} from "../src/features/applications/validation.js";
import {parseApplicationQuery,serializeApplicationQuery} from "../src/features/applications/query-state.js";
import {createApplication,listApplicationsCursor,normalizeApplicationError,openApplicationResume,reassignApplication,updateApplication} from "../src/features/applications/application-service.js";
import {capabilitiesForRoles} from "../src/access/capabilities.js";
import {readFile} from "node:fs/promises";

const id="f3a34ffd-d66a-49f7-815e-c7786857576b",id2="b4d63a80-e306-4a2f-afca-29cd4b3951e0";
const access=(roles,userId=id)=>({roles,userId,status:"ACTIVE",capabilities:capabilitiesForRoles(roles)});

test("application validation accepts a valid create and rejects unsafe fields",()=>{
  assert.equal(validateApplicationCreate({jobDescriptionId:id,resumeId:id2,priority:"NORMAL"}).valid,true);
  assert.equal(validateApplicationCreate({priority:"WRONG"}).valid,false);
  assert.equal(validateApplicationProgress({status:"APPLIED",applicationUrl:"https://example.test/app"}).valid,true);
  assert.equal(validateApplicationProgress({status:"WRONG",applicationUrl:"javascript:alert(1)"}).valid,false);
});

test("application action visibility follows roles and assignment",()=>{
  assert.deepEqual(applicationActions(access(["DEVELOPER"]),{assigned_to:id}),{canCreate:false,canReassign:false,canManageFields:false,canUpdate:false,canOpenResume:false,canDelete:false});
  assert.equal(applicationActions(access(["APPLIER"]),{assigned_to:id}).canUpdate,true);
  assert.equal(applicationActions(access(["APPLIER"]),{assigned_to:id2}).canUpdate,false);
  assert.equal(applicationActions(access(["APPLYING_MANAGER"]),{assigned_to:id2}).canReassign,true);
  assert.equal(applicationActions(access(["ADMIN"]),{assigned_to:null}).canCreate,true);
});

test("application query state is allowlisted and serializable",()=>{
  const value=parseApplicationQuery(`pageSize=50&status=BLOCKED&priority=URGENT&search=Acme&creationMode=BULK&creationBatchId=${id}`);
  assert.equal(value.pageSize,50);assert.equal(value.priority,"URGENT");
  assert.equal(value.creationMode,"BULK");assert.equal(value.creationBatchId,id);
  assert.match(serializeApplicationQuery(value),/status=BLOCKED/);
  assert.equal(parseApplicationQuery("status=INJECTED").status,"");
});

test("application services use protected RPC contracts",async()=>{
  const calls=[],originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");}};
  globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options,body:options.body?JSON.parse(options.body):null});return new Response(JSON.stringify({data:String(url).endsWith("pageSize=25")?{items:[{id}],hasMore:false,nextCursor:null}:{id}}),{status:200});};
  try{const base="https://api.example.com",list=await listApplicationsCursor(client,base,{search:""},null,25);assert.equal(list.items.length,1);await createApplication(client,base,{jobDescriptionId:id,resumeId:id2,priority:"HIGH"});await updateApplication(client,base,id,{status:"IN_PROGRESS",priority:"HIGH"});await updateApplication(client,base,id,{status:"APPLIED",applicationUrl:"https://jobs.example.test/application"});await reassignApplication(client,base,id,id2,"Capacity");}
  finally{globalThis.fetch=originalFetch;}
  assert.deepEqual(calls.map(x=>[x.options.method,x.url.pathname]),[["GET","/api/v1/applications"],["POST","/api/v1/applications"],["PATCH",`/api/v1/applications/${id}/progress`],["PATCH",`/api/v1/applications/${id}/progress`],["PATCH",`/api/v1/applications/${id}/assignment`]]);assert.equal(calls[0].url.searchParams.get("pageSize"),"25");assert.equal(calls[3].body.priority,undefined);
});

test("private resume flow authorizes by Application before signing",async()=>{
  let requested;const originalFetch=globalThis.fetch,client={auth:{getSession:async()=>({data:{session:{access_token:"token"}},error:null})},rpc:()=>{throw new Error("Direct RPC attempted");},storage:{from:()=>{throw new Error("Direct Storage attempted");}}};globalThis.fetch=async(url)=>{requested=url;return new Response(JSON.stringify({data:{signedUrl:"https://signed.test",expiresInSeconds:90}}),{status:200});};
  try{assert.equal(await openApplicationResume(client,"https://api.example.com",id),"https://signed.test");assert.match(requested,new RegExp(`/applications/${id}/resume-file-url$`));}finally{globalThis.fetch=originalFetch;}
});

test("database errors become user-friendly application messages",()=>{
  assert.equal(normalizeApplicationError(new Error("APPLICATION_DUPLICATE: internal")).code,"APPLICATION_DUPLICATE");
  assert.equal(normalizeApplicationError({code:"42501",message:"policy"}).message,"You do not have permission to perform this action.");
});

test("Application pages expose list, create, detail, history, and empty/loading states",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  for(const text of ["ApplicationsPage","CreateApplicationPage","ApplicationDetailPage","Create Application","Assignment History","Status History","No Applications","Loading..."])assert.match(source,new RegExp(text));
});

test("manager Application page exposes persistent bulk assignment controls",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  for(const text of["Assign / Reassign Selected","applications/bulk-assign","storeAssignmentIds","preserveSelectedRowKeys\\s*:\\s*true","CANCELLED","CLOSED","COMPLETED"])assert.match(source,new RegExp(text));
  assert.doesNotMatch(source,/assigned_to != null/);
});

test("Applier Application columns follow the operational priority order",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  const section=source.slice(source.indexOf("const applierColumns ="),source.indexOf("const columns = manager"));
  const labels=["Link","Status","Captured at","Last updated","Primary category"];
  let position=-1;
  for(const label of labels){const match=new RegExp(`title:\\s*\"${label}\"`).exec(section),next=match?.index??-1;assert.ok(next>position,`${label} follows the requested order`);position=next;}
  assert.match(section,/source_url/);
  assert.match(section,/application_url/);
  assert.ok(section.indexOf("numberColumn")<section.indexOf("companyColumn"));
  assert.ok(section.indexOf("companyColumn")<section.indexOf("jobTitleColumn"));
  assert.ok(section.indexOf("jobTitleColumn")<section.indexOf("resumeColumn"));
  assert.ok(section.indexOf("resumeColumn")<section.search(/title:\s*"Link"/));
});

test("manager Application list identifies both sides of the JD and Resume pair",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  const shared=source.slice(source.indexOf("const numberColumn ="),source.indexOf("const managerColumns ="));
  const section=source.slice(source.indexOf("const managerColumns ="),source.indexOf("const applierColumns ="));
  for(const field of ["company","job_title","resume_name","candidate_name"])assert.match(shared,new RegExp(field));
  assert.match(section,/assignee_name/);
  assert.match(section,/numberColumn/);
  assert.match(section,/companyColumn/);
  assert.match(section,/jobTitleColumn/);
  assert.match(section,/resumeColumn/);
  assert.match(section,/title:\s*"Captured at"/);
  assert.match(section,/title:\s*"Last updated"/);
});

test("Application list truncates only Company and Job title with ellipsis", async () => {
  const source = await readFile(new URL("../src/features/applications/application-pages.jsx", import.meta.url), "utf8");
  const company = source.slice(source.indexOf("const companyColumn ="), source.indexOf("const jobTitleColumn ="));
  const jobTitle = source.slice(source.indexOf("const jobTitleColumn ="), source.indexOf("const resumeColumn ="));
  const resume = source.slice(source.indexOf("const resumeColumn ="), source.indexOf("const managerColumns ="));
  const manager = source.slice(source.indexOf("const managerColumns ="), source.indexOf("const applierColumns ="));
  assert.match(company, /EllipsisCell/);
  assert.match(jobTitle, /EllipsisCell/);
  assert.doesNotMatch(resume, /EllipsisCell/);
  assert.doesNotMatch(manager, /title:\s*"Applier profile"[\s\S]*?EllipsisCell/);
  assert.match(source, /applicationsScrollX = manager \? 2262 : 1916/);
});

test("Application number is visible on the list, detail heading, and search",async()=>{
  const source=await readFile(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");
  assert.match(source,/Application #/);
  assert.match(source,/Application number/);
  assert.match(source,/Application #, company, or job title/);
});
