import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/202609301000_v3_135_tailoring_batch_limit_1000.sql');
const extract=(source,name)=>{
  const start=source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0);
  return source.slice(start,source.indexOf('end$$;',start)+6);
};
test('1000-item migration preserves batch behavior and rejects 1001 through both RPCs',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
    create function assert_application_manager() returns void language plpgsql as $$begin if current_setting('test.manager',true)='off' then raise exception 'ACCESS_DENIED';end if;end$$;
    create table tailoring_batches(id uuid primary key,name text,selected_count int,created_by uuid);
    create table tailoring_jobs(id uuid,application_id uuid,status text);
    create table tailoring_batch_items(batch_id uuid,tailoring_job_id uuid,application_id uuid,ordinal int,status text,retryable boolean,finished_at timestamptz,failure_stage text,failure_code text,failure_message text);
    create function request_application_tailoring_v13(uuid) returns jsonb language sql as $$select jsonb_build_object('id',$1,'status','PENDING')$$;
    create function sanitize_tailoring_failure_v21(text) returns text language sql as $$select $1$$;
    create function refresh_tailoring_batch_v21(uuid) returns tailoring_batches language sql as $$select * from tailoring_batches where id=$1$$;
  `);
  for(const [file,name] of [
    ['202608050049_v2_1_resumable_tailoring_batches.sql','create_tailoring_batch_v21'],
    ['202608310109_v3_32_tailoring_selection_status.sql','create_tailoring_batch_v32'],
  ])await db.exec(extract(read(`supabase/migrations/${file}`),name));
  await db.exec('revoke all on function create_tailoring_batch_v21(uuid[],text),create_tailoring_batch_v32(uuid[],text) from public; grant execute on function create_tailoring_batch_v21(uuid[],text),create_tailoring_batch_v32(uuid[],text) to authenticated;');
  const ids=Array.from({length:1001},(_,i)=>`00000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`);
  await assert.rejects(db.query('select create_tailoring_batch_v32($1::uuid[])',[ids.slice(0,501)]),/TAILORING_BATCH_LIMIT/);
  await db.exec(migration);await db.exec(migration);
  await db.exec('set role authenticated');
  for(const fn of ['create_tailoring_batch_v21','create_tailoring_batch_v32']){
    for(const count of [501,1000]){
      const {rows}=await db.query(`select ${fn}($1::uuid[]) as batch`,[ids.slice(0,count)]);
      assert.equal(rows[0].batch.selected_count,count);
    }
    await assert.rejects(db.query(`select ${fn}($1::uuid[])`,[ids]),/Select between 1 and 1000/);
    await assert.rejects(db.query(`select ${fn}($1::uuid[])`,[[]]),/TAILORING_BATCH_LIMIT/);
  }
  await db.exec("set test.manager='off'");
  await assert.rejects(db.query('select create_tailoring_batch_v32($1::uuid[])',[ids.slice(0,1)]),/ACCESS_DENIED/);
  await db.exec("reset role; set test.manager='on'");
  await db.query("insert into tailoring_jobs values($1,$1,'COMPLETED')",[ids[0]]);
  const {rows}=await db.query('select create_tailoring_batch_v32($1::uuid[]) as batch',[[ids[0],ids[1],ids[1]]]);
  assert.equal(rows[0].batch.selected_count,1);
  assert.equal(rows[0].batch.excludedApprovedCount,1);
});

test('dashboard tailoring selection limit matches the API limit',()=>{
  const page=read('dashboard/src/features/applications/application-pages.jsx');
  assert.match(page,/selectedIds\.length>1000/);
  assert.match(page,/Select no more than 1,000 applications for tailoring/);
  const dto=read('apps/api/src/platform/tailoring-batch.dto.ts');
  for(const name of ['CreateTailoringBatchDto','RetryTailoringBatchDto'])assert.match(dto,new RegExp(`class ${name}[^\\n]+ArrayMaxSize\\(1000\\)`));
});
