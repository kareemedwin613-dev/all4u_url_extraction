import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
test('new job snapshots and isolated draft tests execute against PostgreSQL',async t=>{
  const db=new PGlite({extensions:{pgcrypto}}); t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select '${id(999)}'::uuid $$;
    create function is_active_user(uuid) returns boolean language sql stable as $$ select current_setting('test.active',true)='true' $$;
    create function has_any_role(text[],uuid) returns boolean language sql stable as $$ select current_setting('test.role',true)=any($1) $$;
    create table categories(id uuid primary key,parent_id uuid,active boolean);
    create table job_descriptions(id uuid primary key,category_id uuid,subcategory_id uuid,status text,company text,job_title text,description_text text,detected_skills text[]);
    create function job_description_subcategory_ids(uuid) returns uuid[] language sql stable as $$ select '{}'::uuid[] $$;
    create table resumes(id uuid primary key,resume_type text,status text,resume_number integer,skills text[],structured_content jsonb);
    create table applications(id uuid primary key,resume_id uuid,job_description_id uuid,application_number integer);
    create table tailoring_jobs(id uuid primary key,application_id uuid,resume_id uuid,job_description_id uuid,tailored_resume_id uuid,status text default 'PENDING');
    create function build_tailoring_input_v21(uuid) returns jsonb language plpgsql as $$
      begin if current_setting('test.eligible',true)='false' then raise exception 'TAILORING_SOURCE_CHANGED'; end if;
      return jsonb_build_object('contractVersion','1.2'); end $$;
    create function get_tailoring_job_input_v13(uuid) returns jsonb language sql as $$ select jsonb_build_object('jobId',$1,'input',build_tailoring_input_v21($1)) $$;
    create function claim_tailoring_runner_ticket_v15(text) returns jsonb language sql as $$ select jsonb_build_object('jobId',$1::uuid,'input',build_tailoring_input_v21($1::uuid)) $$;
    insert into categories values('${id(1)}',null,true);
    insert into job_descriptions values('${id(10)}','${id(1)}',null,'ACTIVE','Example','Engineer',repeat('Engineering software. ',10),array['TypeScript']);
    insert into resumes values('${id(20)}','ORIGINAL','ACTIVE',1,array['Java'],
      '{"summary":"Original summary","professional_experience":[{"id":"role-1","company":"Example","job_title":"Engineer","experience_details":"Original details","start_date":{"year":2020,"month":1},"is_current":true}]}'::jsonb);
    insert into applications values('${id(30)}','${id(20)}','${id(10)}',1);
    insert into tailoring_jobs(id,application_id,resume_id,job_description_id) values('${id(40)}','${id(30)}','${id(20)}','${id(10)}');
    select set_config('test.role','ADMIN',false),set_config('test.active','true',false);
  `);
  await db.exec(migration('202609241000_v3_111_tailoring_prompt_library.sql'));
  await db.exec(migration('202609241010_v3_112_tailoring_prompt_snapshots.sql'));
  // Use the application's real preview validator, not a permissive stub.
  const validator=migration('202608310108_v3_31_minimal_tailoring_validation.sql');
  await db.exec(validator.slice(validator.indexOf('create or replace function public.assert_tailoring_preview_v14'),validator.indexOf('$$;',validator.indexOf('create or replace function public.assert_tailoring_preview_v14'))+3));
  await db.exec(migration('202609241020_v3_113_tailoring_prompt_draft_tests.sql'));
  await db.exec(migration('202609241100_v3_117_tailoring_prompt_source_context.sql'));
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.result;
  const createJob=async n=>db.query('insert into tailoring_jobs(id,application_id,resume_id,job_description_id) values($1,$2,$3,$4)',[id(n),id(30),id(20),id(10)]);
  const input=n=>value('select build_tailoring_input_v21($1) result',[id(n)]);
  let captured,generic;
  await t.test('compiler preserves role-duration boundary rules and explicit reference dates',async()=>{
    const months=[24,25,36,37,48,49];
    const roles=months.map((m,i)=>({id:`role-${i}`,startDate:'2020-01',endDate:`${2020+Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`}));
    roles.push({id:'year-only',startDate:'2020',endDate:null},{id:'reversed',startDate:'2025-01',endDate:'2020-01'});
    const compiled=await value('select compile_tailoring_prompt_v112($1,$2,$3) result',[
      {sourceResume:{professionalExperience:roles,skills:[]},jobDescription:{id:id(10)}},
      {instructions:'Test'},'2026-09-01T00:00:00Z']);
    const targets=JSON.parse(compiled.promptSnapshot.composedPrompt.split('ROLE_TARGETS_JSON\n')[1].split('\n\n')[0]);
    assert.deepEqual(targets.map(({projects,bullets})=>[projects,bullets]),[[2,4],[3,4],[3,4],[4,5],[4,5],[4,7],[2,4],[2,4]]);
  });
  await t.test('new jobs capture exact prompt and source; old jobs stay explicitly legacy',async()=>{
    await createJob(41); captured=await input(41);
    assert.equal(captured.contractVersion,'1.3'); assert.equal(captured.promptSnapshot.version,1);
    assert.equal(captured.promptSnapshot.contractVersion,'3');
    assert.match(captured.promptSnapshot.composedPrompt,/FIXED OUTPUT CONTRACT v3/);
    assert.match(captured.promptSnapshot.composedPrompt,/"bullets": 7/);
    // The model must see the candidate's real experience to reframe it rather than invent it.
    const context=JSON.parse(captured.promptSnapshot.composedPrompt.split('BEGIN_UNTRUSTED_INPUT_JSON\n')[1].split('\nEND_UNTRUSTED_INPUT_JSON')[0]);
    assert.equal(context.sourceResume.summary,'Original summary');
    assert.equal(context.sourceResume.professionalExperience[0].details,'Original details');
    assert.equal('id' in context.jobDescription,false);
    assert.equal((await input(40)).contractVersion,'1.2');
    await db.query('update tailoring_jobs set application_id=application_id where id=$1',[id(40)]);
    assert.equal((await input(40)).contractVersion,'1.2');
    const provenance=await value('select prompt_provenance result from tailoring_jobs where id=$1',[id(41)]);
    assert.equal(provenance.version,1); assert.equal('composedPrompt' in provenance,false);
    generic=await value('select read_tailoring_prompts_v1($1) result',[provenance.promptId]);
  });
  await t.test('publication and source edits cannot change queued/retried snapshots',async()=>{
    generic=await value("select manage_tailoring_prompt_v1('SAVE',$1,$2,'Generic revised','Use compact bullets.',0) result",[generic.id,generic.revision]);
    generic=await value("select manage_tailoring_prompt_v1('PUBLISH',$1,$2) result",[generic.id,generic.revision]);
    await db.query("update job_descriptions set description_text=description_text||' New source.' where id=$1",[id(10)]);
    await db.query("update tailoring_jobs set status='PROCESSING' where id=$1",[id(41)]);
    assert.deepEqual(await input(41),captured);
    await createJob(42); assert.equal((await input(42)).promptSnapshot.version,2);
    assert.match((await input(42)).promptSnapshot.composedPrompt,/New source/);
    assert.deepEqual((await value('select get_tailoring_job_input_v13($1) result',[id(41)])).input,captured);
    assert.deepEqual((await value('select claim_tailoring_runner_ticket_v15($1) result',[id(41)])).input,captured);
    await db.exec("select set_config('test.eligible','false',false)");
    await assert.rejects(()=>input(41),/TAILORING_SOURCE_CHANGED/);
    await db.exec("select set_config('test.eligible','true',false)");
    await assert.rejects(()=>db.exec("update tailoring_prompt_job_snapshots set input='{}'"),/PROMPT_IMMUTABLE/);
  });
  await t.test('unbound jobs snapshot on attachment; materialization copies provenance',async()=>{
    await db.query('insert into tailoring_jobs(id,resume_id,job_description_id) values($1,$2,$3)',[id(43),id(20),id(10)]);
    await db.query('update tailoring_jobs set application_id=$1 where id=$2',[id(30),id(43)]);
    assert.equal((await input(43)).contractVersion,'1.3');
    await db.query("insert into resumes(id,resume_type) values($1,'TAILORED')",[id(21)]);
    await db.query('update tailoring_jobs set tailored_resume_id=$1 where id=$2',[id(21),id(41)]);
    assert.equal((await value('select tailoring_prompt_provenance result from resumes where id=$1',[id(21)])).version,1);
  });
  const createTest=()=>value('select create_tailoring_prompt_test_v113($1,$2,$3) result',[generic.id,generic.revision,id(30)]);
  const run=(ticket,action,result=null)=>value('select run_tailoring_prompt_test_v113($1,$2,$3) result',[ticket,action,result]);
  await t.test('draft test snapshots unpublished text and submits without creating/assigning a resume',async()=>{
    generic=await value("select manage_tailoring_prompt_v1('SAVE',$1,$2,'Test draft','Draft only writing.',0) result",[generic.id,generic.revision]);
    const created=await createTest(); assert.match(created.ticket,/^tpt_[0-9a-f]{64}$/);
    assert.equal('input' in created.run,false); assert.equal('ticket_hash' in created.run,false);
    await db.exec('set role anon');
    const claimed=await run(created.ticket,'CLAIM');
    assert.equal(claimed.input.promptSnapshot.isTest,true); assert.equal(claimed.input.promptSnapshot.version,null);
    assert.match(claimed.input.promptSnapshot.composedPrompt,/Draft only writing/);
    await assert.rejects(()=>run(created.ticket,'SUBMIT',null),/PROMPT_INVALID/);
    const output={summary:'A tailored summary.',professionalExperience:[{sourceExperienceId:'role-1',tailoredDetails:'- Built reliable software.'}],skills:['Java'],skillGroups:[{name:'Languages',skills:['Java']}],changeSummary:[],unsupportedRequirements:[],warnings:[]};
    assert.equal((await run(created.ticket,'SUBMIT',output)).status,'COMPLETED');
    assert.equal((await run(created.ticket,'SUBMIT',output)).status,'COMPLETED');
    await assert.rejects(()=>run(created.ticket,'CLAIM'),/PROMPT_CONFLICT/);
    await db.exec('reset role');
    assert.equal((await value('select read_tailoring_prompt_test_v113($1) result',[created.run.id])).status,'COMPLETED');
    assert.equal(await value('select count(*)::integer result from resumes'),2);
    assert.equal(await value('select resume_id result from applications where id=$1',[id(30)]),id(20));
    assert.equal((await value('select select_tailoring_prompt_v1($1) result',[id(10)])).instructions,'Use compact bullets.');
  });
  await t.test('test capabilities expire, reject revoked creators, and cannot mutate application data',async()=>{
    const created=await createTest();
    await assert.rejects(()=>run('tpt_'+'a'.repeat(64),'CLAIM'),/PROMPT_TEST_TICKET_EXPIRED/);
    await db.exec("select set_config('test.active','false',false)");
    await assert.rejects(()=>run(created.ticket,'CLAIM'),/PROMPT_FORBIDDEN/);
    await db.exec("select set_config('test.active','true',false)");
    await db.query("update tailoring_prompt_test_runs set expires_at=now()-interval '1 second' where id=$1",[created.run.id]);
    await assert.rejects(()=>run(created.ticket,'CLAIM'),/PROMPT_TEST_TICKET_EXPIRED/);
    assert.equal((await value('select read_tailoring_prompt_test_v113($1) result',[created.run.id])).status,'EXPIRED');
    await db.exec("set role authenticated; select set_config('test.role','APPLIER',false)");
    await assert.rejects(()=>createTest(),/PROMPT_FORBIDDEN/);
    await assert.rejects(()=>db.exec('select * from tailoring_prompt_test_runs'),/permission denied/);
    assert.equal(await value('select count(*)::integer result from tailoring_prompt_job_snapshots'),0);
    await assert.rejects(()=>db.exec("select compile_tailoring_prompt_v112('{}','{}',now())"),/permission denied/);
    await db.exec('reset role');
  });
});
