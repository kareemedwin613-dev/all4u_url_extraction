import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');

test('materialization input carries the headline inputs; only managers edit original headlines',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select '${id(999)}'::uuid $$;
    create function application_actor_can_manage() returns boolean language sql stable as $$ select current_setting('test.role',true) in ('ADMIN','APPLYING_MANAGER') $$;
    create table resumes(id uuid primary key,resume_type text,seniority text,updated_at timestamptz);
    create table job_descriptions(id uuid primary key,job_title text,company text);
    create table tailoring_jobs(id uuid primary key,job_description_id uuid,resume_id uuid,status text,tailored_resume_id uuid,render_format text,render_template_key text,format_selected_by uuid,format_selected_at timestamptz);
    create function begin_tailoring_materialization_v16(uuid) returns jsonb language sql as $$
      select case when current_setting('test.done',true)='true' then jsonb_build_object('alreadyMaterialized',true)
        else jsonb_build_object('alreadyMaterialized',false,'filename','resume.docx','targetPath','owner/job/resume.docx') end $$;
    insert into resumes values('${id(1)}','ORIGINAL','SENIOR',now()),('${id(2)}','TAILORED','SENIOR',now());
    insert into job_descriptions values('${id(10)}','Staff Data Engineer (Remote)','Acme');
    insert into tailoring_jobs(id,job_description_id,resume_id,status,render_format,render_template_key) values('${id(20)}','${id(10)}','${id(1)}','APPROVED','PDF','MODERN_V1');
    select set_config('test.role','ADMIN',false);
  `);
  await db.exec(migration('202609251300_v3_121_tailored_resume_headline.sql'));
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.result;

  assert.equal((await value("select set_resume_headline_v121($1,'  Senior   Data Engineer ') result",[id(1)])).resumeHeadline,'Senior Data Engineer');
  const started=await value('select begin_tailoring_materialization_v19($1) result',[id(20)]);
  assert.deepEqual(started.targetJob,{title:'Staff Data Engineer (Remote)',company:'Acme'});
  assert.equal(started.resumeSeniority,'SENIOR');
  assert.equal(started.resumeHeadline,'Senior Data Engineer');
  assert.equal(started.filename,'resume.pdf');
  assert.equal(started.renderFormat,'PDF');
  await db.exec("select set_config('test.done','true',false)");
  assert.equal('targetJob' in await value('select begin_tailoring_materialization_v19($1) result',[id(20)]),false);

  await assert.rejects(()=>value("select set_resume_headline_v121($1,'Lead') result",[id(2)]),/RESUME_TYPE_INVALID/);
  await assert.rejects(()=>value("select set_resume_headline_v121($1,$2) result",[id(1),'x'.repeat(81)]),/at most 80/);
  assert.equal((await value("select set_resume_headline_v121($1,'  ') result",[id(1)])).resumeHeadline,null);
  await db.exec("select set_config('test.role','APPLIER',false)");
  await assert.rejects(()=>value("select set_resume_headline_v121($1,'Senior Data Engineer') result",[id(1)]),/FORBIDDEN/);
});
