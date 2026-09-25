import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const fix=read('../supabase/migrations/202609241030_v3_114_application_status_preserve_priority.sql');
const legacy=read('../supabase/migrations/202609151400_v3_85_block_jd_on_application_blocked.sql');
const start=legacy.indexOf('create or replace function public.update_application_status_v101(');
const definitions={v85:legacy.slice(start,legacy.indexOf('$$;',start)+3),v110:read('./fixtures/application-status-v110.sql'),
  v116:read('../supabase/migrations/202609211800_v3_106_block_siblings_on_job_block.sql').match(/create or replace function public.update_application_status_v101\([\s\S]*?\$\$;/)[0]};
const restore=read('../supabase/migrations/202609241050_v3_116_restore_application_status_guards.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const due='2026-10-01T00:00:00+00:00';

for(const[version,definition]of Object.entries(definitions))test(`${version}: status-only saves preserve priority and due date`,async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    set timezone='UTC';
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.actor')::uuid $$;
    create function is_active_user(uuid) returns boolean language sql stable as $$ select current_setting('test.active')='true' $$;
    create function has_role(text,uuid) returns boolean language sql stable as $$ select $1=any(string_to_array(current_setting('test.roles'),',')) $$;
    create function application_actor_can_manage() returns boolean language sql stable as $$
      select is_active_user(auth.uid()) and (has_role('ADMIN',auth.uid()) or has_role('APPLYING_MANAGER',auth.uid()))
    $$;
    create table applications(id uuid primary key,assigned_to uuid,job_description_id uuid,status text,
      priority text not null check(priority in('LOW','NORMAL','HIGH','URGENT')),due_at timestamptz,
      application_url text,applied_at timestamptz,notes text,updated_at timestamptz);
    create table job_descriptions(id uuid primary key,application_blocked_at timestamptz,
      application_blocked_by uuid,application_blocked_notes text,application_blocked_from_application_id uuid,updated_at timestamptz);
    create table application_screenshots(application_id uuid);
    create table application_status_history(application_id uuid,status_type text,previous_status text,new_status text,changed_by uuid,notes text);
    create function cancel_sibling_applications_for_blocked_job_v385(uuid,uuid,uuid,text) returns integer language sql as $$ select 0 $$;
    insert into job_descriptions(id) values('${id(10)}');
    insert into applications(id,assigned_to,job_description_id,status,priority,due_at)
      values('${id(1)}','${id(20)}','${id(10)}','ASSIGNED','HIGH','${due}'),
        ('${id(2)}','${id(20)}','${id(10)}','ASSIGNED','NORMAL','${due}');
    grant select on applications,job_descriptions,application_status_history to authenticated;
  `);
  await db.exec(definition);
  await db.exec(`revoke all on function update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz) from public,anon;
    grant execute on function update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz) to authenticated;`);
  const actor=async(roles='ADMIN',actorId=id(99),active=true)=>{
    await db.exec('reset role');
    await db.query("select set_config('test.actor',$1,false),set_config('test.roles',$2,false),set_config('test.active',$3,false)",[actorId,roles,String(active)]);
    await db.exec('set role authenticated');
  };
  const update=async({priority=null,dueAt=null,status='APPLIED',url='https://example.test/confirmation',notes='Submitted'}={})=>
    (await db.query('select update_application_status_v101($1,$2,$3,null,$4,$5,$6) result',[id(1),status,url,notes,priority,dueAt])).rows[0].result;
  const reset=async()=>{
    await db.exec(`reset role; update applications set status='ASSIGNED',priority='HIGH',due_at='${due}',applied_at=null,application_url=null;
      truncate application_status_history,application_screenshots;`);
    await actor();
  };
  await actor();
  await assert.rejects(()=>update(),/APPLICATION_INVALID_PRIORITY/,'reproduce the exact extension failure before the patch');
  await db.exec('reset role'); await db.exec(version==='v116'?restore:fix);
  if(version==='v116')await db.exec(restore); // Fresh/repaired/retried restores are idempotent.
  await t.test('admin, manager and multi-role accounts can mark Applied without editing priority',async()=>{
    for(const roles of ['ADMIN','APPLYING_MANAGER','ADMIN,APPLIER']){
      await reset();await actor(roles);
      const row=await update();assert.equal(row.status,'APPLIED');assert.equal(row.priority,'HIGH');assert.equal(row.due_at,due);
      assert.ok(row.applied_at);assert.equal(row.application_url,'https://example.test/confirmation');
      const history=(await db.query('select * from application_status_history')).rows;
      assert.equal(history.length,1);assert.equal(history[0].new_status,'APPLIED');assert.equal(history[0].changed_by,id(99));
      await update();assert.equal((await db.query('select * from application_status_history')).rows.length,1);
    }
  });
  await t.test('preserves each priority from the currently locked row, with no client-side default',async()=>{
    for(const priority of ['LOW','NORMAL','HIGH','URGENT']){
      await reset();await db.exec('reset role');await db.query('update applications set priority=$1 where id=$2',[priority,id(1)]);await actor();
      assert.equal((await update()).priority,priority);
    }
  });
  await t.test('explicit manager edits still validate priorities and can clear or change due dates',async()=>{
    await reset();
    for(const priority of ['',' ','INVALID'])await assert.rejects(()=>update({priority}),/APPLICATION_INVALID_PRIORITY/);
    const explicit=await update({priority:' urgent ',dueAt:null});assert.equal(explicit.priority,'URGENT');assert.equal(explicit.due_at,null);
    const withDate=await update({dueAt:'2026-10-05T00:00:00Z'});assert.equal(withDate.priority,'URGENT');assert.equal(withDate.due_at,'2026-10-05T00:00:00+00:00');
  });
  await t.test('appliers retain protected fields and URL/screenshot requirements',async()=>{
    await reset();await actor('APPLIER',id(20));
    await assert.rejects(()=>update({url:null}),/APPLICATION_APPLIED_REQUIRES_URL/);
    await assert.rejects(()=>update(),/APPLICATION_APPLIED_REQUIRES_SCREENSHOT/);
    await db.exec('reset role');await db.query('insert into application_screenshots values($1)',[id(1)]);await actor('APPLIER',id(20));
    const row=await update({priority:'URGENT',dueAt:'2027-01-01'});assert.equal(row.status,'APPLIED');assert.equal(row.priority,'HIGH');assert.equal(row.due_at,due);
    await assert.rejects(()=>update({status:'CANCELLED'}),/APPLICATION_PROTECTED_FIELDS/);
  });
  await t.test('unauthorized/inactive callers remain rejected and function permissions survive',async()=>{
    await reset();await actor('APPLIER',id(77));await assert.rejects(()=>update(),/APPLICATION_ACCESS_DENIED/);
    await actor('ADMIN',id(99),false);await assert.rejects(()=>update(),/APPLICATION_ACCESS_DENIED/);
    await db.exec('reset role; set role anon');await assert.rejects(()=>update(),/permission denied/);
  });
  if(version==='v110'||version==='v116')await t.test('local blocking stays local: no JD block or sibling cancellation is restored',async()=>{
    await reset();await actor('APPLIER',id(20));
    const row=await update({status:'BLOCKED',notes:'References required'});assert.equal(row.status,'BLOCKED');assert.equal(row.siblings_cancelled,0);
    assert.equal((await db.query('select status from applications where id=$1',[id(2)])).rows[0].status,'ASSIGNED');
    assert.equal((await db.query('select application_blocked_at from job_descriptions')).rows[0].application_blocked_at,null);
  });
  await t.test('unexpected definitions stop migration rather than silently omitting a fix',async()=>{
    await db.exec('reset role');await assert.rejects(()=>db.exec(fix),/APPLICATION_STATUS_PATCH_CONFLICT/);
  });
});
