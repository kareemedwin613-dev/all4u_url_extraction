import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const migration=read('202609241040_v3_115_retire_javascript_typescript_subtype.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fn=(sql,name)=>{const start=sql.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);return sql.slice(start,sql.indexOf('$$;',start)+3);};

test('retires JS/TS taxonomy without widening matching, changing skills, or cancelling applications',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon;create role authenticated;
    create function application_actor_can_manage() returns boolean language sql stable as $$ select current_setting('test.manager',true)='true' $$;
    create table categories(id uuid primary key,slug text,name text,parent_id uuid,active boolean,updated_at timestamptz);
    create table job_descriptions(id uuid primary key,category_id uuid,subcategory_id uuid,updated_at timestamptz);
    create table resumes(id uuid primary key,primary_category_id uuid,subcategory_id uuid,status text default 'ACTIVE',resume_type text default 'ORIGINAL',skills text[],updated_at timestamptz);
    create table resume_tech_stacks(id uuid primary key default gen_random_uuid(),resume_id uuid,primary_category_id uuid,subcategory_id uuid,sort_order integer default 0);
    create unique index resume_null_sub on resume_tech_stacks(resume_id,primary_category_id) where subcategory_id is null;
    create table job_description_subcategories(id uuid primary key default gen_random_uuid(),job_description_id uuid,subcategory_id uuid,sort_order integer default 0);
    create table applications(id uuid primary key,job_description_id uuid,resume_id uuid,status text);
    create function resume_has_primary_category(uuid,uuid) returns boolean language sql stable as $$ select exists(select 1 from resume_tech_stacks where resume_id=$1 and primary_category_id=$2) $$;
    -- Production's existing primary-only helper; the retirement wrapper must not
    -- silently widen legacy bulk previews for affected JDs.
    create function resume_matches_job_for_bulk(p_resume_id uuid,p_category_id uuid,p_job_description_id uuid default null)
      returns boolean language sql stable as $$ select exists(select 1 from resumes r join categories c on c.id=$2 and c.active and c.parent_id is null
        where r.id=$1 and r.resume_type='ORIGINAL' and r.status='ACTIVE' and resume_has_primary_category(r.id,c.id)) $$;
    insert into categories(id,slug,name,parent_id,active) values
      ('${id(1)}','software-engineering','Software Engineering',null,true),('${id(2)}','data-engineering','Data Engineering',null,true),
      ('${id(10)}','javascript-typescript-engineering','JavaScript / TypeScript Engineering','${id(1)}',true),
      ('${id(11)}','java','Java','${id(1)}',true),('${id(12)}','csharp','C#','${id(1)}',true);
    insert into job_descriptions(id,category_id,subcategory_id) values
      ('${id(101)}','${id(1)}','${id(10)}'), -- JS only
      ('${id(102)}','${id(1)}','${id(10)}'), -- JS first, Java survives
      ('${id(103)}','${id(1)}','${id(11)}'), -- Java first, JS second
      ('${id(104)}','${id(1)}',null),       -- unrelated untagged JD
      ('${id(105)}','${id(2)}',null),       -- unrelated primary
      ('${id(106)}','${id(1)}','${id(10)}'); -- legacy-only JS reference
    insert into job_description_subcategories(job_description_id,subcategory_id,sort_order) values
      ('${id(101)}','${id(10)}',0),('${id(102)}','${id(10)}',0),('${id(102)}','${id(11)}',1),
      ('${id(103)}','${id(11)}',0),('${id(103)}','${id(10)}',1);
    insert into resumes(id,primary_category_id,subcategory_id,skills) values
      ('${id(201)}','${id(1)}','${id(10)}',array['JavaScript','TypeScript']),
      ('${id(202)}','${id(1)}','${id(10)}',array['Java','JavaScript','TypeScript']),
      ('${id(203)}','${id(1)}','${id(11)}',array['Java']);
    insert into resume_tech_stacks(resume_id,primary_category_id,subcategory_id,sort_order) values
      ('${id(201)}','${id(1)}','${id(10)}',0),('${id(202)}','${id(1)}','${id(10)}',0),
      ('${id(202)}','${id(1)}','${id(11)}',1),('${id(202)}','${id(2)}',null,2),('${id(203)}','${id(1)}','${id(11)}',0);
    insert into applications values('${id(301)}','${id(101)}','${id(201)}','ASSIGNED');
  `);
  const categorySql=read('202609111000_v3_77_application_matching_choice.sql');
  await db.exec(categorySql.slice(categorySql.indexOf('create function public.application_category_candidate_v377'),categorySql.indexOf('$$;')+3));
  await db.exec(fn(read('202609031235_v3_57_resume_tech_stacks.sql'),'validate_resume_tech_stack_row'));
  await db.exec(fn(read('202609101400_v3_70_job_description_subcategories.sql'),'validate_job_description_subcategory_row'));
  await db.exec(`create trigger validate_resume before insert or update on resume_tech_stacks for each row execute function validate_resume_tech_stack_row();
    create trigger validate_jd before insert or update on job_description_subcategories for each row execute function validate_job_description_subcategory_row();`);
  const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const matches=async(job,resume,bulk=false)=>(await query(bulk?'select resume_matches_job_for_bulk($2,$3,$1) result':'select application_category_candidate_v377($1,$2) result',bulk?[id(job),id(resume),id(1)]:[id(job),id(resume)]))[0].result;
  const beforeApps=await query('select * from applications'),beforeSkills=await query('select id,skills from resumes order by id');
  assert.equal(await matches(101,201),true);
  await db.exec(`begin;${migration}commit;`);
  await t.test('tag is inactive, removed from all assignments, and archived for recovery',async()=>{
    assert.equal((await query('select active from categories where id=$1',[id(10)]))[0].active,false);
    for(const table of ['job_description_subcategories','resume_tech_stacks','job_descriptions','resumes'])
      assert.equal((await query(`select count(*)::int n from ${table} where subcategory_id=$1`,[id(10)]))[0].n,0);
    assert.equal((await query('select count(*)::int n from retired_taxonomy_assignments'))[0].n,11);
    assert.deepEqual(await query('select * from applications'),beforeApps);
    assert.deepEqual(await query('select id,skills from resumes order by id'),beforeSkills);
  });
  await t.test('JS-only and legacy-only JDs cannot fall back to primary matching',async()=>{
    for(const job of [101,106])for(const bulk of [false,true])for(const resume of [201,202,203])assert.equal(await matches(job,resume,bulk),false);
    assert.equal((await query('select resume_has_primary_category($1,$2) result',[id(201),id(1)]))[0].result,true,'resume primary preserved');
  });
  await t.test('other subtypes keep matching and unrelated untagged JDs retain their old behavior',async()=>{
    for(const job of [102,103])for(const bulk of [false,true]){
      assert.equal(await matches(job,202,bulk),true);assert.equal(await matches(job,203,bulk),true);assert.equal(await matches(job,201,bulk),false);
    }
    assert.equal(await matches(104,201),true);assert.equal(await matches(105,202),true);
  });
  await t.test('retagging restores eligibility but clearing tags never bypasses retirement guard',async()=>{
    await db.query('insert into job_description_subcategories(job_description_id,subcategory_id) values($1,$2)',[id(101),id(11)]);
    await db.query('update job_descriptions set subcategory_id=$2 where id=$1',[id(101),id(11)]);
    assert.equal(await matches(101,203),true);
    await db.query('delete from job_description_subcategories where job_description_id=$1',[id(101)]);
    await db.query('update job_descriptions set subcategory_id=null where id=$1',[id(101)]);
    assert.equal(await matches(101,203),false);
  });
  await t.test('stale clients cannot add retired assignments and audit records are read-only',async()=>{
    await assert.rejects(()=>db.query('insert into job_description_subcategories(job_description_id,subcategory_id) values($1,$2)',[id(101),id(10)]),/JOB_SUBCATEGORY_INVALID/);
    await assert.rejects(()=>db.query('insert into resume_tech_stacks(resume_id,primary_category_id,subcategory_id) values($1,$2,$3)',[id(201),id(1),id(10)]),/RESUME_TECH_STACK_INVALID/);
    await db.exec("set role authenticated;select set_config('test.manager','false',false)");
    assert.equal((await query('select * from retired_taxonomy_assignments')).length,0);
    await db.exec("select set_config('test.manager','true',false)");
    assert.ok((await query('select * from retired_taxonomy_assignments')).length>0);
    await assert.rejects(()=>db.exec('delete from retired_taxonomy_assignments'),/permission denied/);
    await db.exec('reset role');
  });
});
