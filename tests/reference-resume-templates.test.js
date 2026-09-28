import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const migration=read("../supabase/migrations/202609281010_v3_128_reference_resume_templates.sql");
const active=["ALEGREYA_CLASSIC_V1","AMIRI_COMPACT_V1","LORA_BANDS_V1","CRIMSON_BANDS_V1","TITILLIUM_BANNER_V1","TITILLIUM_EXPERIENCE_V1"];
const legacy=["CLASSIC_V1","MODERN_V1","COMPACT_V1","EXECUTIVE_V1","TECHNICAL_V1","MINIMAL_V1","CORPORATE_V1","ELEGANT_V1","SLATE_V1","EMERALD_V1","ACADEMIC_V1","IMPACT_V1"];
test("new layout keys agree across API, persistence, and contracts; fonts are packaged offline",()=>{
  const specs=read("../apps/api/src/platform/reference-resume-templates.ts"),contracts=read("../packages/contracts/src/index.ts");
  assert.deepEqual([...specs.matchAll(/key:"([A-Z_0-9]+)"/g)].map(match=>match[1]),active);
  for(const key of [...active,...legacy]){assert.ok(migration.includes(`'${key}'`));assert.ok(contracts.includes(`"${key}"`));}
  assert.match(read("../vercel.json"),/apps\/api\/assets\/resume-fonts\/\*\*/);
  for(const family of ["alegreya","amiri","lora","crimson-text","titillium-web"]){
    assert.match(read(`../apps/api/assets/resume-fonts/${family}-LICENSE.txt`),/SIL OPEN FONT LICENSE/i);
    for(const variant of ["400-normal","700-normal","400-italic"]){const bytes=readFileSync(new URL(`../apps/api/assets/resume-fonts/${family}-${variant}.woff`,import.meta.url));assert.equal(bytes.subarray(0,4).toString(),"wOFF");}
  }
});
test("migration preserves legacy records, randomizes only new keys, and retains selector authorization/locking",async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const jobId="00000000-0000-4000-8000-000000000001",actor="00000000-0000-4000-8000-000000000002";
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
    create function assert_application_manager() returns void language plpgsql as $$begin if current_setting('test.manager')<>'true' then raise exception 'FORBIDDEN';end if;end$$;
    create table tailoring_jobs(id uuid primary key default gen_random_uuid(),application_id uuid,status text,render_template_key text,template_selected_by uuid,template_selected_at timestamptz,updated_at timestamptz);
    create table resumes(id uuid primary key default gen_random_uuid(),resume_type text,render_template_key text);
    insert into tailoring_jobs(id,application_id,status,render_template_key,updated_at) values('${jobId}','${jobId}','APPROVED','CLASSIC_V1','2026-01-01');
    insert into resumes(resume_type,render_template_key) values('ORIGINAL',null);
  `);
  for(const key of legacy)await db.query("insert into resumes(resume_type,render_template_key) values('TAILORED',$1)",[key]);
  const before=(await db.query("select * from resumes order by id")).rows;
  await db.exec(migration);await db.exec(migration);
  assert.deepEqual((await db.query("select * from resumes order by id")).rows,before);
  const samples=(await db.query("select random_tailored_resume_template_v34() as key from generate_series(1,1000)")).rows;
  assert.deepEqual([...new Set(samples.map(row=>row.key))].sort(),[...active].sort());
  for(const key of active)await db.query("insert into resumes(resume_type,render_template_key) values('TAILORED',$1)",[key]);
  await assert.rejects(()=>db.query("insert into resumes(resume_type,render_template_key) values('TAILORED','BAD')"),/resumes_render_template_check/);
  await db.exec("set test.manager='true';set role authenticated");
  for(const key of active){
    const updated=await db.query("select select_tailoring_template_v18($1,$2,'2026-01-01'::timestamptz) result",[jobId,key]);
    assert.equal(updated.rows[0].result.renderTemplateKey,key);
    await db.exec(`reset role;update tailoring_jobs set updated_at='2026-01-01' where id='${jobId}';set role authenticated`);
  }
  await assert.rejects(()=>db.query("select random_tailored_resume_template_v34()"),/permission denied/);
  await assert.rejects(()=>db.query("select select_tailoring_template_v18($1,'BAD','2026-01-01')",[jobId]),/TAILORING_TEMPLATE_INVALID/);
  await assert.rejects(()=>db.query("select select_tailoring_template_v18($1,$2,'2025-01-01')",[jobId,active[0]]),/TAILORING_TEMPLATE_CONFLICT/);
  await db.exec("set test.manager='false'");
  await assert.rejects(()=>db.query("select select_tailoring_template_v18($1,$2,'2026-01-01')",[jobId,active[0]]),/FORBIDDEN/);
  await db.exec(`reset role;set test.manager='true';update tailoring_jobs set status='COMPLETED' where id='${jobId}';set role authenticated`);
  await assert.rejects(()=>db.query("select select_tailoring_template_v18($1,$2,'2026-01-01')",[jobId,active[0]]),/TAILORING_TEMPLATE_LOCKED/);
});
