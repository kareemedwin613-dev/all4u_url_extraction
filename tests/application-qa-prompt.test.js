import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {buildApplicationQaPrompt} from "../extension/shared/application-qa-prompt.js";
import {copyApplicationQaPrompt} from "../extension/services/application-service.js";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const context={resumeType:"TAILORED",resumeText:"Alex\n\nExperience\nBuilt APIs.",jobDescription:"Build software.\nUse Python.",company:"Acme",jobTitle:"Engineer"};

test("fixed Q&A prompt contains complete documents, instructions and the attached Resume type",()=>{
  for(const resumeType of ["ORIGINAL","TAILORED"]){
    const input={...context,resumeType,resumeText:"R".repeat(300000),jobDescription:"J".repeat(200000)};
    const prompt=buildApplicationQaPrompt(input);
    assert.ok(prompt.includes(input.resumeText));assert.ok(prompt.includes(input.jobDescription));
    assert.match(prompt,/Company: Acme\nRole: Engineer/);
    assert.match(prompt,/wait for my first question/);assert.match(prompt,/Do not invent employers/);
    assert.ok(prompt.includes(`Resume used for this application: ${resumeType==="TAILORED"?"Tailored":"Original"}`));
  }
  for(const field of ["resumeText","jobDescription","resumeType"]){
    assert.throws(()=>buildApplicationQaPrompt({...context,[field]:""}),/text is missing/);
  }
});

test("Copy Q&A makes one authenticated context read and writes only to the clipboard",async t=>{
  const client={auth:{getSession:async()=>({data:{session:{access_token:"jwt"}}})}};
  let calls=0,copied;
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    calls++;assert.equal(url,`https://api.example.com/api/v1/applications/${id(1)}/qa-context`);
    assert.equal(options.headers.Authorization,"Bearer jwt");
    return new Response(JSON.stringify({data:context}));
  });
  await copyApplicationQaPrompt(client,"https://api.example.com",id(1),async text=>{copied=text;});
  assert.equal(copied,buildApplicationQaPrompt(context));assert.equal(calls,1);
  await assert.rejects(()=>copyApplicationQaPrompt(client,"https://api.example.com",id(1),async()=>{throw Error("blocked");}),/Clipboard access failed/);
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({message:"Access denied"}),{status:403}));
  await assert.rejects(()=>copyApplicationQaPrompt(client,"https://api.example.com",id(1),()=>assert.fail("must not copy")),/Access denied/);
});

test("Q&A database context is authorized and selects the current attached Resume, never its parent",async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.viewer',true),'')::uuid $$;
    create function is_active_user(uuid) returns boolean language sql stable as $$ select $1 is not null and current_setting('test.active',true)='yes' $$;
    create function application_actor_can_view(uuid) returns boolean language sql stable as $$ select $1=auth.uid() or current_setting('test.manager',true)='yes' $$;
    create table resumes(id uuid primary key,resume_type text,resume_text text,status text,parent_resume_id uuid);
    create table job_descriptions(id uuid primary key,company text,job_title text,description_text text);
    create table applications(id uuid primary key,application_number int,resume_id uuid,job_description_id uuid,assigned_to uuid);
    insert into resumes values('${id(1)}','ORIGINAL','Original text','ACTIVE',null),('${id(2)}','TAILORED','Tailored text','ACTIVE','${id(1)}');
    insert into job_descriptions values('${id(3)}','Acme','Engineer','Full JD');
    insert into applications values('${id(4)}',72396,'${id(2)}','${id(3)}','${id(9)}');
    select set_config('test.viewer','${id(9)}',false),set_config('test.active','yes',false),set_config('test.manager','no',false);
  `);
  await db.exec(read("../supabase/migrations/202610061400_v3_154_application_qa_context.sql"));
  const load=async()=> (await db.query("select get_application_qa_context_v3154($1) result",[id(4)])).rows[0].result;
  assert.deepEqual(await load(),{applicationNumber:72396,company:"Acme",jobTitle:"Engineer",jobDescription:"Full JD",resumeId:id(2),resumeType:"TAILORED",resumeText:"Tailored text"});
  await db.exec(`update applications set resume_id='${id(1)}'`);
  assert.equal((await load()).resumeText,"Original text");
  await db.exec(`select set_config('test.viewer','${id(8)}',false)`);
  await assert.rejects(load,/APPLICATION_CONTEXT_UNAVAILABLE/);
  await db.exec("select set_config('test.manager','yes',false)");
  assert.equal((await load()).resumeType,"ORIGINAL");
  await db.exec("select set_config('test.active','no',false)");
  await assert.rejects(load,/APPLICATION_ACCESS_DENIED/);
  await db.exec("select set_config('test.active','yes',false),set_config('test.viewer','',false)");
  await assert.rejects(load,/APPLICATION_ACCESS_DENIED/);
  await db.exec(`select set_config('test.viewer','${id(9)}',false); update resumes set status='ARCHIVED' where id='${id(1)}'`);
  await assert.rejects(load,/APPLICATION_CONTEXT_UNAVAILABLE/);
  await db.exec(`update resumes set status='ACTIVE',resume_text='' where id='${id(1)}'`);
  await assert.rejects(load,/APPLICATION_CONTEXT_INCOMPLETE/);
  await db.exec(`update resumes set resume_text='Resume' where id='${id(1)}'; update job_descriptions set description_text=''`);
  await assert.rejects(load,/APPLICATION_CONTEXT_INCOMPLETE/);
  const grants=await db.query("select has_function_privilege('anon','get_application_qa_context_v3154(uuid)','EXECUTE') anon,has_function_privilege('authenticated','get_application_qa_context_v3154(uuid)','EXECUTE') signed_in");
  assert.deepEqual(grants.rows[0],{anon:false,signed_in:true});
});

test("extension Q&A button uses existing action restrictions and is wired to the view",()=>{
  const card=read("../extension/sidepanel/components/ApplicationCard.jsx"),view=read("../extension/sidepanel/views/MyApplicationsView.jsx");
  assert.match(card,/disabled=\{!actionsEnabled \|\| !application.resume_id \|\| Boolean\(extensionBusy\)\} loading=\{extensionBusy === `\$\{application.id\}:COPY_QA_PROMPT`\}/);
  assert.match(card,/onCopyQaPrompt\(application\)/);assert.match(view,/onCopyQaPrompt=\{copyQaPrompt\}/);
});
