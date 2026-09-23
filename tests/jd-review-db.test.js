import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";
import {decide, savedSource} from "../apps/jd-review-worker/src/review.mjs";

const migration = name => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
test("bulk review database lifecycle, scope, audit and application preservation", async t => {
  const db = new PGlite({extensions:{pgcrypto}}); t.after(()=>db.close());
  const actor=randomUUID(),primary=randomUUID(),sub=randomUUID(),industry=randomUUID();
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key, active boolean default true, manager boolean default true);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.is_active_user(uuid) returns boolean language sql stable as $$select coalesce((select active from public.profiles where id=$1),false)$$;
    create function public.application_actor_can_manage() returns boolean language sql stable as $$select coalesce((select active and manager from public.profiles where id=auth.uid()),false)$$;
    insert into auth.users values ('${actor}'); insert into public.profiles(id) values ('${actor}');
    select set_config('request.jwt.claim.sub','${actor}',false);
  `);
  const base=await migration("202607210001_create_application_schema.sql");
  await db.exec(base.split(/\r?\n/).filter(x=>/^create table public\.(categories|job_descriptions)\(/.test(x)).join("\n"));
  await db.exec((await migration("202607220005_add_structured_job_and_resume_fields.sql")).split("alter table public.resumes")[0]);
  await db.exec(await migration("202607220008_add_job_salary_range.sql"));
  await db.exec(`
    create table public.industry_domain_categories(id uuid primary key,name text,active boolean default true);
    alter table public.job_descriptions add column industry_domain_category_id uuid references public.industry_domain_categories,
      add column review_status text not null default 'NEEDS_REVIEW',add column review_comment text,add column review_decline_reason text,
      add column reviewed_by uuid,add column reviewed_at timestamptz,add column archived_at timestamptz,add column archived_by uuid,add column archive_reason text,
      add column application_blocked_at timestamptz,add column application_blocked_by uuid,add column application_blocked_notes text default '';
    create table public.job_description_review_history(id bigint generated always as identity,job_description_id uuid,previous_status text,new_status text,decline_reason text,comment text,reviewed_by uuid,reviewed_at timestamptz);
    create table public.applications(id uuid primary key default gen_random_uuid(),job_description_id uuid references public.job_descriptions(id),assigned_to uuid,status text default 'UNASSIGNED');
    insert into public.categories(id,slug,name) values('${primary}','software-engineering','Software Engineering');
    insert into public.categories(id,slug,name,parent_id) values('${sub}','frontend','Frontend','${primary}');
    insert into public.industry_domain_categories(id,name) values('${industry}','Technology');
  `);
  const review=await migration("202608120055_v2_7_jd_review_workflow.sql");
  await db.exec(review.slice(review.indexOf("create or replace function public.maintain_job_description_review_v27()"),review.indexOf("create or replace function public.review_job_description_v27(")));
  await db.exec((await migration("202609101400_v3_70_job_description_subcategories.sql")).split("-- Matching:")[0]);
  await db.exec(await migration("202609231000_v3_104_bulk_jd_review.sql"));
  const manage=async(operation,body={})=>(await db.query("select public.jd_review_manage($1,$2::jsonb) value",[operation,JSON.stringify(body)])).rows[0].value;
  const run=async(ticket,operation,body={})=>(await db.query("select public.jd_review_runner($1,$2,$3::jsonb) value",[operation,ticket,JSON.stringify(body)])).rows[0].value;
  async function job() {
    const id=randomUUID();
    await db.query("insert into public.job_descriptions(id,company,job_title,category_id,description_text,source_url,industry_domain_category_id) values($1,'Example','Engineer',$2,repeat('source description ',10),'https://example.com/job',$3)",[id,primary,industry]);
    await db.query("select public.replace_job_description_subcategories($1,$2,$3::uuid[],true)",[id,primary,[sub]]);
    return id;
  }
  async function batch(id) { const b=await manage("create",{jobDescriptionIds:[id]}); const ticket=await manage("ticket",{id:b.id}); return {...b,...ticket}; }
  const current=async id=>(await db.query("select * from public.job_descriptions where id=$1",[id])).rows[0];
  const approved={outcome:"APPROVED",changes:{job_title:"Senior Engineer"},comment:"Title corrected from live posting."};
  const submit=(ticket,item,result=approved)=>run(ticket,"submit",{itemId:item.itemId,leaseToken:item.leaseToken,result});

  await t.test("approve corrected facts, audit actor and before/after; repeated submission is idempotent",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    assert.equal(item.model,"gpt-5.6-sol");assert.equal(item.promptVersion,"jd-review-v1");
    assert.equal((await submit(b.ticket,item)).status,"APPROVED");
    assert.equal((await submit(b.ticket,item)).status,"APPROVED");
    const j=await current(id);assert.equal(j.job_title,"Senior Engineer");assert.equal(j.review_status,"APPROVED");assert.equal(j.reviewed_by,actor);
    const history=(await db.query("select * from public.job_description_review_history where job_description_id=$1",[id])).rows;
    assert.equal(history.length,1);assert.match(history[0].comment,/jd-review-v1/);
    const detail=await manage("detail",{id:b.id});assert.deepEqual(detail.items[0].fieldChanges.job_title,{before:"Engineer",after:"Senior Engineer"});
    assert.equal(detail.items[0].lease_token,undefined);assert.equal((await run(b.ticket,"next")).done,true);
    assert.ok((await manage("list")).some(x=>x.id===b.id && x.finished===1));
  });
  await t.test("inaccessible/uncertain retains original facts, records finder comment and can retry",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    await submit(b.ticket,item,{outcome:"NEEDS_ATTENTION",changes:{company:"Must not save"},comment:"CAPTCHA: unable to verify the job."});
    const j=await current(id);assert.equal(j.company,"Example");assert.equal(j.review_status,"NEEDS_CORRECTION");assert.match(j.review_comment,/CAPTCHA/);
    await manage("retry",{id:b.id});assert.ok((await run(b.ticket,"next")).itemId);
  });
  await t.test("block expired or hybrid-or-remote without touching existing unassigned applications",async()=>{
    for(const reason of ["EXPIRED","HYBRID_OR_REMOTE"]) {
      const id=await job();await db.query("insert into public.applications(job_description_id) values($1)",[id]);
      const before=(await db.query("select * from public.applications where job_description_id=$1",[id])).rows;
      const b=await batch(id),item=await run(b.ticket,"next");
      await submit(b.ticket,item,{outcome:"BLOCKED",blockReason:reason,changes:{},comment:`Confirmed ${reason}.`});
      const j=await current(id);assert.equal(j.status,"ARCHIVED");assert.equal(j.review_status,"DECLINED");assert.ok(j.application_blocked_at);
      assert.deepEqual((await db.query("select * from public.applications where job_description_id=$1",[id])).rows,before);
    }
  });
  await t.test("assigned JDs skip both before claim and after model processing",async()=>{
    const id=await job();await db.query("insert into public.applications(job_description_id,assigned_to,status) values($1,$2,'ASSIGNED')",[id,actor]);
    const before=await current(id),b=await batch(id);assert.equal((await run(b.ticket,"next")).done,true);assert.deepEqual(await current(id),before);
    assert.equal((await manage("detail",{id:b.id})).items[0].status,"SKIPPED");
    const id2=await job(),b2=await batch(id2),item=await run(b2.ticket,"next");
    await db.query("insert into public.applications(job_description_id,assigned_to,status) values($1,$2,'ASSIGNED')",[id2,actor]);
    assert.equal((await submit(b2.ticket,item)).status,"SKIPPED");assert.equal((await current(id2)).review_status,"NEEDS_REVIEW");
  });
  await t.test("concurrent manager edits are preserved instead of overwritten",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    await db.query("update public.job_descriptions set company='Manual update' where id=$1",[id]);
    assert.equal((await submit(b.ticket,item)).status,"NEEDS_ATTENTION");assert.equal((await current(id)).company,"Manual update");
  });
  await t.test("leases reclaim interrupted work, reject stale tokens and bound retries",async()=>{
    const id=await job(),b=await batch(id),first=await run(b.ticket,"next");
    await db.query("update public.jd_review_items set lease_expires_at=now()-interval '1 minute' where id=$1",[first.itemId]);
    const second=await run(b.ticket,"next");assert.notEqual(first.leaseToken,second.leaseToken);
    await assert.rejects(submit(b.ticket,first),/JD_REVIEW_LEASE_INVALID/);
    await db.query("update public.jd_review_items set lease_expires_at=now()-interval '1 minute',attempt_count=3 where id=$1",[first.itemId]);
    assert.equal((await run(b.ticket,"next")).done,true);
    assert.equal((await manage("detail",{id:b.id})).items[0].status,"NEEDS_ATTENTION");
  });
  await t.test("cross-batch results, invalid taxonomy and unsupported fields cannot write",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next"),other=await batch(await job());
    await assert.rejects(submit(other.ticket,item),/JD_REVIEW_LEASE_INVALID/);
    await assert.rejects(submit(b.ticket,item,{...approved,changes:{category_id:randomUUID()}}),/JD_REVIEW_RESULT_INVALID/);
    await assert.rejects(submit(b.ticket,item,{...approved,changes:{source_url:"https://other.example"}}),/JD_REVIEW_RESULT_INVALID/);
    await assert.rejects(submit(b.ticket,item,{...approved,changes:{subcategory_ids:[]}}),/Software Engineering jobs require/);
    assert.equal((await current(id)).job_title,"Engineer");
  });
  await t.test("ticket rotation, expiration, cancellation and revoked manager access stop writes",async()=>{
    const id=await job(),b=await batch(id); const newTicket=await manage("ticket",{id:b.id});
    await assert.rejects(run(b.ticket,"next"),/JD_REVIEW_TICKET_EXPIRED/);
    await db.query("update public.jd_review_tickets set expires_at=now()-interval '1 second' where batch_id=$1",[b.id]);
    await assert.rejects(run(newTicket.ticket,"next"),/JD_REVIEW_TICKET_EXPIRED/);
    const active=await manage("ticket",{id:b.id});await db.query("update public.profiles set manager=false where id=$1",[actor]);
    await assert.rejects(run(active.ticket,"next"),/JD_REVIEW_FORBIDDEN/);await assert.rejects(manage("list"),/JD_REVIEW_FORBIDDEN/);
    await db.query("update public.profiles set manager=true where id=$1",[actor]);await manage("cancel",{id:b.id});
    await assert.rejects(run(active.ticket,"next"),/JD_REVIEW_TICKET_EXPIRED/);
    assert.equal((await manage("detail",{id:b.id})).items[0].status,"CANCELLED");
    const grants=(await db.query("select has_table_privilege('anon','public.jd_review_tickets','SELECT') tickets,has_function_privilege('anon','public.jd_review_manage(text,jsonb)','EXECUTE') manager,has_function_privilege('anon','public.jd_review_snapshot(uuid)','EXECUTE') snapshot")).rows[0];
    assert.deepEqual(grants,{tickets:false,manager:false,snapshot:false});
  });
  const legacy=await batch(await job());
  await db.exec(await migration("202609231100_v3_105_saved_jd_classification.sql"));
  const v2=changes=>({outcome:"APPROVED",changes,comment:"Classified saved JD and filled missing information.",verification:{source:"SAVED_JD",liveUrlChecked:false}});
  await t.test("v2 default preserves legacy history and prevents resuming URL review",async()=>{
    assert.equal((await manage("detail",{id:legacy.id})).batch.prompt_version,"jd-review-v1");
    await assert.rejects(manage("ticket",{id:legacy.id}),/JD_REVIEW_LEGACY_BATCH/);
    await assert.rejects(manage("retry",{id:legacy.id}),/JD_REVIEW_LEGACY_BATCH/);
    await assert.rejects(run(legacy.ticket,"next"),/JD_REVIEW_LEGACY_BATCH/);
    assert.equal((await batch(await job())).prompt_version,"jd-classify-v2");
  });
  await t.test("v2 fills blanks, stores multiple SE subtypes and retains before/after audit",async()=>{
    const csharp=randomUUID(),java=randomUUID();
    await db.query("insert into public.categories(id,slug,name,parent_id) values($1,'csharp','C#',$3),($2,'java','Java',$3)",[csharp,java,primary]);
    const id=await job();await db.query("update public.job_descriptions set industry_domain_category_id=null where id=$1",[id]);
    const b=await batch(id),item=await run(b.ticket,"next");
    assert.equal(item.promptVersion,"jd-classify-v2");
    await submit(b.ticket,item,v2({subcategory_ids:[csharp,java],seniority:"SENIOR",industry_domain_category_id:industry}));
    const j=await current(id);assert.equal(j.company,"Example");assert.equal(j.job_title,"Engineer");assert.equal(j.seniority,"SENIOR");assert.equal(j.category_id,primary);
    assert.deepEqual((await db.query("select public.job_description_subcategory_ids($1) ids",[id])).rows[0].ids,[csharp,java]);
    const detail=await manage("detail",{id:b.id});assert.deepEqual(detail.items[0].fieldChanges.subcategory_ids.after,[csharp,java]);
    assert.match(j.review_comment,/jd-classify-v2/);assert.match(j.review_comment,/Live posting availability not checked/);
  });
  await t.test("non-Software Engineering categories clear subtype tags with history",async()=>{
    for(const slug of ["data-engineering","ai-engineering","devops"]) {
      const category=randomUUID();await db.query("insert into public.categories(id,slug,name) values($1,$2,$2)",[category,slug]);
      const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
      await submit(b.ticket,item,v2({category_id:category}));
      assert.equal((await current(id)).subcategory_id,null);
      assert.deepEqual((await db.query("select public.job_description_subcategory_ids($1) ids",[id])).rows[0].ids,[]);
      const detail=await manage("detail",{id:b.id});assert.deepEqual(detail.items[0].fieldChanges.subcategory_ids,{before:[sub],after:[]});
    }
  });
  await t.test("server rejects nonblank overwrites, old source contracts and new blocking decisions",async()=>{
    const id=await job();await db.query("update public.job_descriptions set seniority='SENIOR',travel_required=false,salary_min=0 where id=$1",[id]);
    const b=await batch(id),item=await run(b.ticket,"next");
    for(const changes of [{company:"Other"},{job_title:"Other"},{seniority:"MID"},{travel_required:true},{salary_min:123},{industry_domain_category_id:industry}]) {
      await assert.rejects(submit(b.ticket,item,v2(changes)),/JD_REVIEW_RESULT_INVALID/);
    }
    await assert.rejects(submit(b.ticket,item,{...v2({}),verification:{url:"https://example.com",httpStatus:200}}),/JD_REVIEW_RESULT_INVALID/);
    await assert.rejects(submit(b.ticket,item,{...v2({}),outcome:"BLOCKED",blockReason:"EXPIRED"}),/JD_REVIEW_RESULT_INVALID/);
    assert.equal((await current(id)).review_status,"NEEDS_REVIEW");
    await submit(b.ticket,item,v2({location_text:"Remote-USA"}));
    const j=await current(id);assert.equal(j.location_text,"Remote-USA");assert.equal(j.seniority,"SENIOR");assert.equal(j.travel_required,false);assert.equal(Number(j.salary_min),0);assert.equal(j.application_blocked_at,null);
  });
  await t.test("v2 still skips late assignments and preserves concurrent edits",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    await db.query("insert into public.applications(job_description_id,assigned_to,status) values($1,$2,'ASSIGNED')",[id,actor]);
    assert.equal((await submit(b.ticket,item,v2({seniority:"SENIOR"}))).status,"SKIPPED");
    const id2=await job(),b2=await batch(id2),item2=await run(b2.ticket,"next");
    await db.query("update public.job_descriptions set company='Manual update' where id=$1",[id2]);
    assert.equal((await submit(b2.ticket,item2,v2({seniority:"SENIOR"}))).status,"NEEDS_ATTENTION");assert.equal((await current(id2)).company,"Manual update");
  });
  const oldV2=await batch(await job());
  await db.exec(await migration("202609231200_v3_106_jd_corrections_need_review.sql"));
  const v3=(changes,evidence={})=>({...v2(changes),applyChanges:true,evidence,corrected:false,comment:"Corrected metadata to match the saved description."});
  async function describedJob(text) {
    const id=await job();await db.query("update public.job_descriptions set description_text=$2 where id=$1",[id,text+" Additional role description.".repeat(10)]);return id;
  }
  await t.test("v3 version pins new batches and preserves older batch history",async()=>{
    assert.equal((await batch(await job())).prompt_version,"jd-classify-v3");
    await assert.rejects(manage("ticket",{id:oldV2.id}),/JD_REVIEW_LEGACY_BATCH/);
    await assert.rejects(run(oldV2.ticket,"next"),/JD_REVIEW_LEGACY_BATCH/);
    assert.equal((await manage("detail",{id:oldV2.id})).batch.prompt_version,"jd-classify-v2");
  });
  await t.test("populated corrections force Needs Correction despite submitted approval, with audit and idempotency",async()=>{
    const id=await describedJob("Acme is hiring a Senior Software Engineer. Remote."),b=await batch(id),item=await run(b.ticket,"next");
    const result=v3({company:"Acme",job_title:"Senior Software Engineer",seniority:"SENIOR"},{company:"Acme",job_title:"Senior Software Engineer",seniority:"Senior"});
    assert.equal((await submit(b.ticket,item,result)).status,"NEEDS_ATTENTION");
    assert.equal((await submit(b.ticket,item,result)).status,"NEEDS_ATTENTION");
    const j=await current(id);assert.equal(j.company,"Acme");assert.equal(j.job_title,"Senior Software Engineer");assert.equal(j.seniority,"SENIOR");assert.equal(j.review_status,"NEEDS_CORRECTION");
    assert.match(j.review_comment,/Corrected existing values; Needs Correction/);assert.match(j.review_comment,/jd-classify-v3/);
    const detail=await manage("detail",{id:b.id});assert.equal(detail.items[0].result.corrected,true);
    assert.deepEqual(detail.items[0].fieldChanges.company,{before:"Example",after:"Acme"});
    const history=(await db.query("select * from public.job_description_review_history where job_description_id=$1",[id])).rows;
    assert.equal(history.length,1);assert.equal(history[0].new_status,"NEEDS_CORRECTION");
    await manage("retry",{id:b.id});assert.equal((await run(b.ticket,"next")).done,true);
    assert.deepEqual((await manage("detail",{id:b.id})).items[0].fieldChanges,detail.items[0].fieldChanges);
  });
  await t.test("primary correction clears non-SE subtypes and requires review",async()=>{
    const category=(await db.query("select id from public.categories where slug='data-engineering'")).rows[0].id;
    const id=await describedJob("Data Engineer"),b=await batch(id),item=await run(b.ticket,"next");
    await submit(b.ticket,item,{...v3({category_id:category,subcategory_ids:[]},{category_id:"Data Engineer",subcategory_ids:"Data Engineer"}),outcome:"NEEDS_ATTENTION"});
    const j=await current(id);assert.equal(j.category_id,category);assert.equal(j.review_status,"NEEDS_CORRECTION");
    const detail=await manage("detail",{id:b.id});assert.deepEqual(detail.items[0].fieldChanges.subcategory_ids,{before:[sub],after:[]});
  });
  await t.test("supported blank fills and identical populated values can still approve",async()=>{
    const id=await describedJob("Senior Software Engineer"),b=await batch(id),item=await run(b.ticket,"next");
    await submit(b.ticket,item,v3({seniority:"SENIOR",company:"Example",subcategory_ids:[sub]},{seniority:"  SENIOR  "}));
    assert.equal((await current(id)).review_status,"APPROVED");
    const detail=await manage("detail",{id:b.id});assert.equal(detail.items[0].result.corrected,false);assert.deepEqual(detail.items[0].changes,{seniority:"SENIOR"});
  });
  await t.test("zero and false are populated; supported replacement requires review",async()=>{
    const id=await describedJob("Salary 120000. Travel required.");
    await db.query("update public.job_descriptions set salary_min=0,travel_required=false where id=$1",[id]);
    const b=await batch(id),item=await run(b.ticket,"next");
    await submit(b.ticket,item,v3({salary_min:120000,travel_required:true},{salary_min:"120000",travel_required:"Travel required"}));
    assert.equal((await current(id)).review_status,"NEEDS_CORRECTION");assert.equal((await current(id)).travel_required,true);
  });
  await t.test("unsupported edits, missing evidence and changed source contract roll back",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next"),before=await current(id);
    for(const result of [v3({company:"Other"}),v3({company:"Other"},{company:"absent quote"}),
      v3({source_url:"https://other.example"},{source_url:"source description"}),
      {...v3({company:"Other"},{company:"source description"}),applyChanges:false},
      {...v3({}),verification:{source:"LIVE_URL",liveUrlChecked:true}}]) {
      await assert.rejects(submit(b.ticket,item,result),/JD_REVIEW_RESULT_INVALID/);
      assert.deepEqual(await current(id),before);
    }
    await submit(b.ticket,item,{...v3({}),applyChanges:false,outcome:"NEEDS_ATTENTION",comment:"Ambiguous; existing values retained."});
    assert.equal((await current(id)).company,"Example");assert.equal((await current(id)).review_status,"NEEDS_CORRECTION");
    await manage("retry",{id:b.id});assert.ok((await run(b.ticket,"next")).itemId);
  });
  await t.test("v3 still skips assigned applications and protects concurrent manager edits",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    await db.query("insert into public.applications(job_description_id,assigned_to,status) values($1,$2,'ASSIGNED')",[id,actor]);
    assert.equal((await submit(b.ticket,item,v3({}))).status,"SKIPPED");
    const id2=await job(),b2=await batch(id2),item2=await run(b2.ticket,"next");
    await db.query("update public.job_descriptions set company='Manual update' where id=$1",[id2]);
    assert.equal((await submit(b2.ticket,item2,v3({}))).status,"NEEDS_ATTENTION");assert.equal((await current(id2)).company,"Manual update");
  });
  const oldV3=await batch(await job());
  await db.exec(await migration("202609231300_v3_107_ai_review_auto_approve.sql"));
  const v4=changes=>({...v3(changes),outcome:"AI_REVIEWED"});
  await t.test("v4 uses new statuses without rewriting or approving legacy results",async()=>{
    assert.equal((await batch(await job())).prompt_version,"jd-classify-v4");
    await assert.rejects(manage("ticket",{id:oldV3.id}),/JD_REVIEW_LEGACY_BATCH/);
    await assert.rejects(run(oldV3.ticket,"next"),/JD_REVIEW_LEGACY_BATCH/);
    assert.equal((await manage("detail",{id:oldV3.id})).batch.prompt_version,"jd-classify-v3");
  });
  await t.test("completed corrections autoapprove with AI-reviewed status, comment and audit",async()=>{
    const id=await describedJob("Acme is hiring a Senior Engineer"),b=await batch(id),item=await run(b.ticket,"next");
    const result=v4({company:"Acme",job_title:"Senior Engineer",seniority:"SENIOR"});
    delete result.evidence;
    assert.equal((await submit(b.ticket,item,result)).status,"AI_REVIEWED");
    assert.equal((await submit(b.ticket,item,result)).status,"AI_REVIEWED");
    const j=await current(id);assert.equal(j.company,"Acme");assert.equal(j.review_status,"APPROVED");assert.equal(j.reviewed_by,actor);
    assert.match(j.review_comment,/AI reviewed \[jd-classify-v4/);assert.doesNotMatch(j.review_comment,/Needs Correction/);
    const detail=await manage("detail",{id:b.id});assert.equal(detail.items[0].result.corrected,true);
    assert.deepEqual(detail.items[0].fieldChanges.company,{before:"Example",after:"Acme"});
    assert.equal((await db.query("select count(*)::int n from public.job_description_review_history where job_description_id=$1",[id])).rows[0].n,1);
    await manage("retry",{id:b.id});assert.equal((await run(b.ticket,"next")).done,true);
    assert.equal((await manage("list")).find(x=>x.id===b.id).ai_reviewed,1);
  });
  await t.test("real worker decision preserves uncertain salary and saves other changes automatically",async()=>{
    const id=await describedJob("Senior applied AI role. Industry should be Technology; base salary provided without period."),b=await batch(id),item=await run(b.ticket,"next");
    const ai=item.categories.find(c=>c.slug==='ai-engineering').id;
    const result=decide({primaryCategoryId:ai,subtypeIds:[],uncertainFields:["salary_period"],comment:"Classified as AI Engineering. Salary period retained.",
      changes:[{field:"salary_period",value:"YEAR"},{field:"seniority",value:"SENIOR"}]},savedSource(item.job),item);
    result.verification={source:"SAVED_JD",liveUrlChecked:false};
    assert.equal((await submit(b.ticket,item,result)).status,"AI_REVIEWED");
    const j=await current(id);assert.equal(j.category_id,ai);assert.equal(j.seniority,"SENIOR");assert.equal(j.salary_period,item.job.salary_period);
    assert.equal(j.review_status,"APPROVED");assert.equal(j.subcategory_id,null);assert.match(j.review_comment,/salary_period/);
  });
  await t.test("no technology subtype does not force review or invent a matching tag",async()=>{
    const id=await job();await db.query("select public.replace_job_description_subcategories($1,$2,'{}'::uuid[],false)",[id,primary]);
    const b=await batch(id),item=await run(b.ticket,"next");
    assert.equal((await submit(b.ticket,item,v4({}))).status,"AI_REVIEWED");
    assert.equal((await current(id)).review_status,"APPROVED");assert.equal((await current(id)).subcategory_id,null);
  });
  await t.test("technical failure preserves JD status, is counted and can retry",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next"),before=await current(id);
    const result={outcome:"FAILED",changes:{},applyChanges:false,comment:"MODEL_TIMEOUT: review did not complete.",verification:{source:"SAVED_JD",liveUrlChecked:false}};
    assert.equal((await submit(b.ticket,item,result)).status,"FAILED");assert.deepEqual(await current(id),before);
    assert.equal((await manage("list")).find(x=>x.id===b.id).failed,1);
    assert.equal((await run(b.ticket,"next")).failedCount,1);
    await manage("retry",{id:b.id});const retried=await run(b.ticket,"next");
    assert.equal((await submit(b.ticket,retried,v4({}))).status,"AI_REVIEWED");assert.equal((await current(id)).review_status,"APPROVED");
  });
  await t.test("v4 retains essential source/taxonomy/lease/assignment protection",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next"),before=await current(id);
    for(const result of [v4({source_url:"https://other.example"}),v4({category_id:randomUUID()}),
      {...v4({company:"Acme"}),outcome:"FAILED"}, {...v4({}),outcome:"NEEDS_ATTENTION"}]) {
      await assert.rejects(submit(b.ticket,item,result),/JD_REVIEW_RESULT_INVALID/);assert.deepEqual(await current(id),before);
    }
    await db.query("insert into public.applications(job_description_id,assigned_to,status) values($1,$2,'ASSIGNED')",[id,actor]);
    assert.equal((await submit(b.ticket,item,v4({}))).status,"SKIPPED");assert.deepEqual(await current(id),before);
  });
  await t.test("v4 concurrent edits and exhausted leases never imply successful review",async()=>{
    const id=await job(),b=await batch(id),item=await run(b.ticket,"next");
    await db.query("update public.job_descriptions set company='Manual update' where id=$1",[id]);
    assert.equal((await submit(b.ticket,item,v4({}))).status,"FAILED");assert.equal((await current(id)).company,"Manual update");
    assert.equal((await current(id)).review_status,"NEEDS_REVIEW");
    const id2=await job(),b2=await batch(id2),item2=await run(b2.ticket,"next");
    await db.query("update public.jd_review_items set lease_expires_at=now()-interval '1 minute',attempt_count=3 where id=$1",[item2.itemId]);
    assert.equal((await run(b2.ticket,"next")).failedCount,1);assert.equal((await current(id2)).review_status,"NEEDS_REVIEW");
  });
});
