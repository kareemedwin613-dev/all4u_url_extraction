import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const functionFrom = (source,name) => {
  const start=source.indexOf(`create or replace function public.${name}(`);
  return source.slice(start,source.indexOf('end$$;',start)+6);
};
const ticket = `trb_${'a'.repeat(43)}`;

test('batch retry reuses an approved preview after a PDF failure and regenerates everything else',async t=>{
  const db=new PGlite({extensions:{pgcrypto}}); t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table tailoring_batches(id uuid primary key,status text,next_retry_at timestamptz,started_at timestamptz,completed_at timestamptz,pause_reason text,
      pending_count int default 0,processing_count int default 0,waiting_retry_count int default 0,review_count int default 0,failed_count int default 0,skipped_count int default 0);
    create table tailoring_jobs(id uuid primary key,status text,processed_by uuid,started_at timestamptz,completed_at timestamptz,failure_code text,failure_message text,
      output_preview jsonb,output_schema_version int,preview_generated_at timestamptz);
    create table tailoring_batch_items(id uuid primary key,batch_id uuid,tailoring_job_id uuid,ordinal int,status text,attempt_count int default 0,lease_token uuid,lease_expires_at timestamptz,
      started_at timestamptz,finished_at timestamptz,failure_stage text,failure_code text,failure_message text,retryable boolean,next_retry_at timestamptz);
    create table tailoring_batch_runner_tickets(id uuid primary key,batch_id uuid,token_hash text,status text,run_expires_at timestamptz,created_by uuid,completed_at timestamptz);
    create function assert_application_manager() returns void language sql as $$ select $$;
    create function refresh_tailoring_batch_v21(uuid) returns tailoring_batches language sql as $$ select * from tailoring_batches where id=$1 $$;
    create function build_tailoring_input_v21(uuid) returns jsonb language sql as $$ select jsonb_build_object('contractVersion','1.3') $$;
    create function sanitize_tailoring_failure_v21(text) returns text language sql as $$ select $1 $$;
    insert into tailoring_batches(id,status) values('${id(1)}','COMPLETED_WITH_FAILURES');
    insert into tailoring_batch_runner_tickets values('${id(2)}','${id(1)}',encode(extensions.digest('${ticket}','sha256'),'hex'),'CLAIMED',now()+interval '1 hour','${id(3)}',null);
    insert into tailoring_jobs values
      ('${id(11)}','APPROVED',null,null,null,'RENDER_FAILED','The approved content remains available.','{"summary":"Approved"}',1,now()),
      ('${id(12)}','FAILED',null,null,null,'VALIDATION_FAILED','Rejected.','{"summary":"Stale"}',1,now());
    insert into tailoring_batch_items(id,batch_id,tailoring_job_id,ordinal,status,failure_stage,failure_code,retryable) values
      ('${id(21)}','${id(1)}','${id(11)}',1,'FAILED','API_SUBMISSION','RENDER_FAILED',true),
      ('${id(22)}','${id(1)}','${id(12)}',2,'FAILED','OUTPUT_VALIDATION','VALIDATION_FAILED',true);
  `);
  const v21=migration('202608050049_v2_1_resumable_tailoring_batches.sql');
  await db.exec(functionFrom(v21,'retry_tailoring_batch_items_v21'));
  await db.exec(functionFrom(v21,'next_tailoring_batch_item_v21'));
  await db.exec(migration('202609241110_v3_118_tailoring_batch_reuse_approved_preview.sql'));
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.result;

  assert.equal((await value('select retry_tailoring_batch_items_v21($1) result',[id(1)])).retriedCount,2);
  assert.deepEqual(await value('select output_preview result from tailoring_jobs where id=$1',[id(11)]),{summary:'Approved'});
  assert.equal(await value('select output_preview result from tailoring_jobs where id=$1',[id(12)]),null);
  assert.equal(await value('select preview_generated_at is null result from tailoring_jobs where id=$1',[id(12)]),true);

  await db.exec('set role anon');
  const first=await value('select next_tailoring_batch_item_v21($1) result',[ticket]);
  assert.deepEqual([first.state,first.itemId,first.approvedPreview],['JOB',id(21),{summary:'Approved'}]);
  const second=await value('select next_tailoring_batch_item_v21($1) result',[ticket]);
  assert.deepEqual([second.state,second.itemId,'approvedPreview' in second],['JOB',id(22),false]);
  await assert.rejects(()=>db.query('select next_tailoring_batch_item_legacy_v118($1)',[ticket]),/permission denied/);
  await db.exec('reset role');
});
