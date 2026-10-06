import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";

test("screenshot AI review: scoped queue, original profile, decisions, storage, audit and races", async t => {
  const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
  const actor=randomUUID(),guideId=randomUUID(),profile=randomUUID(),tailored=randomUUID(),job=randomUUID();
  await db.exec(`
    create role anon;create role authenticated;create schema auth;create schema extensions;create schema storage;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key,active boolean default true,manager boolean default true);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.is_active_user(uuid) returns boolean language sql stable as $$select coalesce((select active from profiles where id=$1),false)$$;
    create function public.has_role(text,uuid) returns boolean language sql stable as $$select coalesce((select manager from profiles where id=$2),false)$$;
    create function public.application_actor_can_manage() returns boolean language sql stable as $$select public.has_role('ADMIN',auth.uid())$$;
    create table public.resumes(id uuid primary key,parent_resume_id uuid,updated_at timestamptz default now(),candidate_name text,candidate_first_name text,candidate_middle_name text,candidate_last_name text,
      candidate_email text,candidate_phone text,address_line_1 text,address_line_2 text,address_city text,address_state_region text,address_postal_code text,address_country text,linkedin_url text,github_url text,portfolio_url text,structured_content jsonb default '{}');
    create table public.job_descriptions(id uuid primary key,company text,job_title text,salary_min numeric,salary_max numeric,salary_currency text,salary_period text);
    create table public.applications(id uuid primary key,application_number bigint generated always as identity,resume_id uuid references resumes,job_description_id uuid references job_descriptions,updated_at timestamptz default now(),
      screenshot_review_status text not null default '',screenshot_feedback text default '',screenshot_feedback_by uuid,screenshot_feedback_at timestamptz,status text default 'APPLIED');
    create table public.application_screenshots(id uuid primary key,application_id uuid references applications,storage_path text,mime_type text,file_size_bytes bigint,created_at timestamptz default now());
    create table public.resume_application_answers(resume_id uuid,answer_key text,question_patterns text[],answer_value jsonb,updated_at timestamptz default now(),active boolean,review_status text);
    create table public.application_guide_entries(id uuid primary key,question text,meaning text,how_to_answer text,example_answer text,version integer,sort_order integer,status text);
    create table storage.objects(bucket_id text,name text);
    alter table storage.objects enable row level security;
    insert into profiles(id) values('${actor}');insert into auth.users values('${actor}');select set_config('request.jwt.claim.sub','${actor}',false);
    insert into resumes(id,candidate_name,candidate_email) values('${profile}','Original Candidate','original@example.test');
    insert into resumes(id,parent_resume_id,candidate_name,candidate_email) values('${tailored}','${profile}','Wrong Generated Identity','wrong@example.test');
    insert into job_descriptions(id,company,job_title) values('${job}','Example','Engineer');
    insert into application_guide_entries values('${guideId}','Email','Contact address','Use candidate email','example@example.test',3,1,'PUBLISHED');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/202610061200_v3_152_screenshot_ai_review.sql",import.meta.url),"utf8"));
  const manage=async(op,body={})=>(await db.query("select screenshot_review_manage($1,$2) value",[op,JSON.stringify(body)])).rows[0].value;
  const run=async(ticket,op,body={})=>(await db.query("select screenshot_review_runner($1,$2,$3) value",[op,ticket,JSON.stringify(body)])).rows[0].value;
  async function fixture({reviewed=false,shots=true}={}) {
    const app=randomUUID(),shot=randomUUID();
    await db.query("insert into applications(id,resume_id,job_description_id,screenshot_review_status) values($1,$2,$3,$4)",[app,tailored,job,reviewed?"CORRECT":""]);
    if(shots)await db.query("insert into application_screenshots(id,application_id,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'image/png',1000)",[shot,app,`${actor}/${app}/${shot}.png`]);
    const b=await manage("create",{applicationIds:[app],model:"test-vision"});const {ticket}=await manage("ticket",{id:b.id});
    return {app,shot,batch:b.id,ticket};
  }
  const result=(f,verdict="CORRECT")=>({complete:true,screenshots:[{id:f.shot,readable:true,complete:true}],fields:[{field:"Email",observed:"original@example.test",expected:"original@example.test",verdict,basis:"PROFILE",guideId:null,screenshotId:f.shot,location:"Tile 1, Email",reason:"Matches candidate.email"}]});
  const submit=(f,item,raw=result(f))=>run(f.ticket,"submit",{itemId:item.itemId,leaseToken:item.leaseToken,result:raw});
  const current=async f=>(await db.query("select * from applications where id=$1",[f.app])).rows[0];

  await t.test("original identity + published guide snapshot, correct result and idempotent history",async()=>{
    const f=await fixture(),item=await run(f.ticket,"next");
    assert.equal(item.source.candidate.email,"original@example.test");assert.equal(item.guide[0].version,3);
    assert.deepEqual(item.assumptions,{gpa:"FORMAT_ONLY",citizenship:"US_CITIZEN"});
    await db.query("update application_guide_entries set version=4 where id=$1",[guideId]);
    assert.equal((await submit(f,item)).status,"CORRECT");assert.equal((await submit(f,item)).status,"CORRECT");
    const app=await current(f);assert.equal(app.screenshot_review_status,"CORRECT");assert.equal(app.screenshot_feedback,"");assert.equal(app.status,"APPLIED");
    const history=await manage("history",{id:f.app});assert.equal(history.length,1);assert.equal(history[0].initiated_by,actor);assert.equal(history[0].prompt_version,"screenshot-review-v1");
    const detail=await manage("detail",{id:f.batch});assert.equal(detail.batch.guide_snapshot[0].version,3);assert.equal(detail.items[0].lease_token,undefined);assert.equal(detail.items[0].source_snapshot,undefined);
    assert.equal(detail.items[0].has_result,true);assert.equal(detail.items[0].company,"Example");assert.equal((await manage("list")).find(x=>x.id===f.batch).correct,1);
    assert.equal((await manage("result",{id:item.itemId})).result.fields[0].field,"Email");
  });
  await t.test("supported mistakes save feedback; uncertainty and missing coverage do not approve",async()=>{
    const f=await fixture(),item=await run(f.ticket,"next");assert.equal((await submit(f,item,result(f,"INCORRECT"))).status,"HAS_MISTAKES");assert.match((await current(f)).screenshot_feedback,/AI screenshot review/);
    for(const mode of ["field","coverage","incomplete","noFields"]){const q=await fixture(),i=await run(q.ticket,"next"),r=result(q);if(mode==="field")r.fields[0].verdict="CANNOT_VERIFY";if(mode==="coverage")r.screenshots[0].readable=false;if(mode==="incomplete")r.complete=false;if(mode==="noFields")r.fields=[];
      assert.equal((await submit(q,i,r)).status,"CANNOT_VERIFY");assert.equal((await current(q)).screenshot_review_status,"");}
  });
  await t.test("malformed output, unknown guide references, missing/duplicate screenshots fail closed",async()=>{
    const f=await fixture(),item=await run(f.ticket,"next");
    for(const mutate of [r=>r.fields=null,r=>r.complete="true",r=>r.screenshots=[],r=>r.screenshots.push(r.screenshots[0]),r=>{r.fields[0].basis="GUIDE";r.fields[0].guideId=randomUUID();},r=>r.fields[0].verdict="APPROVE"]){const r=result(f);mutate(r);await assert.rejects(submit(f,item,r),/RESULT_INVALID/);}
    assert.equal((await current(f)).screenshot_review_status,"");
  });
  await t.test("human review / screenshots / profile changes prevent stale updates",async()=>{
    for(const change of ["human","shot","profile"]){const f=await fixture(),item=await run(f.ticket,"next");
      if(change==="human")await db.query("update applications set screenshot_review_status='HAS_MISTAKES',screenshot_feedback='Human finding' where id=$1",[f.app]);
      if(change==="shot")await db.query("update application_screenshots set storage_path='replacement.png' where id=$1",[f.shot]);
      if(change==="profile")await db.query("update resumes set candidate_phone=$1 where id=$2",[randomUUID(),profile]);
      assert.equal((await submit(f,item)).status,"SKIPPED");if(change==="human")assert.equal((await current(f)).screenshot_feedback,"Human finding");}
  });
  await t.test("already reviewed and no-screenshot items skip; two concurrent batches cannot overwrite",async()=>{
    for(const options of [{reviewed:true},{shots:false}]){const f=await fixture(options);assert.equal((await run(f.ticket,"next")).done,true);assert.equal((await manage("detail",{id:f.batch})).items[0].status,"SKIPPED");}
    const f=await fixture(),other=await manage("create",{applicationIds:[f.app],model:"test-vision"}),ticket=(await manage("ticket",{id:other.id})).ticket;
    const one=await run(f.ticket,"next"),two=await run(ticket,"next");await submit(f,one);assert.equal((await submit({...f,ticket},two)).status,"SKIPPED");
  });
  await t.test("lease expiry, reclaim, failure retry and immutable previous attempts",async()=>{
    const f=await fixture(),one=await run(f.ticket,"next");await db.query("update screenshot_review_items set lease_expires_at=now()-interval '1 second' where id=$1",[one.itemId]);
    const two=await run(f.ticket,"next");assert.notEqual(one.leaseToken,two.leaseToken);await assert.rejects(submit(f,one),/LEASE_INVALID/);
    await run(f.ticket,"fail",{itemId:two.itemId,leaseToken:two.leaseToken,code:"SCREENSHOT_DOWNLOAD_FAILED"});await manage("retry",{id:f.batch});
    const three=await run(f.ticket,"next");await submit(f,three);assert.equal((await manage("history",{id:f.app})).length,2);
  });
  await t.test("storage capability binds exact path, item, lease, issuer role, expiry and batch",async()=>{
    const f=await fixture(),i=await run(f.ticket,"next"),path=i.source.screenshots[0].path;
    const check=async(headers,requested=path)=>(await db.query("select set_config('request.headers',$1,false),screenshot_review_storage_allowed('application-screenshots',$2) allowed",[JSON.stringify(headers),requested])).rows[0].allowed;
    const headers={"x-screenshot-review-ticket":f.ticket,"x-screenshot-review-item":i.itemId,"x-screenshot-review-lease":i.leaseToken};
    assert.equal(await check(headers),true);assert.equal(await check({}),false);assert.equal(await check(headers,"other.png"),false);assert.equal(await check({...headers,"x-screenshot-review-item":randomUUID()}),false);
    await db.query("update profiles set manager=false where id=$1",[actor]);assert.equal(await check(headers),false);await assert.rejects(run(f.ticket,"next"),/FORBIDDEN/);await assert.rejects(manage("list"),/FORBIDDEN/);
    await db.query("update profiles set manager=true where id=$1",[actor]);await manage("ticket",{id:f.batch});assert.equal(await check(headers),false);await assert.rejects(submit(f,i),/TICKET_EXPIRED/);
    const fresh=(await manage("ticket",{id:f.batch})).ticket;await manage("cancel",{id:f.batch});await assert.rejects(run(fresh,"next"),/TICKET_EXPIRED/);
    const grants=(await db.query("select has_table_privilege('anon','screenshot_review_tickets','SELECT') tickets,has_function_privilege('anon','screenshot_review_manage(text,jsonb)','EXECUTE') manage,has_function_privilege('anon','screenshot_review_source(uuid)','EXECUTE') source")).rows[0];assert.deepEqual(grants,{tickets:false,manage:false,source:false});
  });
});
