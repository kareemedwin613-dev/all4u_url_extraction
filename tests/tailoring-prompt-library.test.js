import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(new URL("../supabase/migrations/202609241000_v3_111_tailoring_prompt_library.sql", import.meta.url), "utf8");
const baseline = readFileSync(new URL("../apps/tailoring-worker/src/prompt-template.ts", import.meta.url), "utf8")
  .match(/instructions: `([\s\S]*?)`,/)[1].replace(/\r\n/g, "\n");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("versioned prompt library executes publication, selection, and permission rules", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor',true),'')::uuid
    $$;
    create function public.is_active_user(uuid) returns boolean language sql stable as $$
      select $1 is not null and current_setting('test.active',true)='true'
    $$;
    create function public.has_any_role(text[],uuid) returns boolean language sql stable as $$
      select current_setting('test.role',true)=any($1)
    $$;
    create table categories(id uuid primary key,parent_id uuid,active boolean);
    create table job_descriptions(id uuid primary key,category_id uuid,subcategory_id uuid);
    create table job_description_subcategories(job_description_id uuid,subcategory_id uuid);
    create function public.job_description_subcategory_ids(uuid) returns uuid[] language sql stable as $$
      select coalesce((select array_agg(subcategory_id) from job_description_subcategories where job_description_id=$1),
        (select case when subcategory_id is null then '{}'::uuid[] else array[subcategory_id] end from job_descriptions where id=$1))
    $$;
    insert into categories values
      ('${id(1)}',null,true),('${id(2)}',null,true),('${id(3)}',null,false),
      ('${id(11)}','${id(1)}',true),('${id(12)}','${id(1)}',true),('${id(13)}','${id(1)}',false),
      ('${id(21)}','${id(2)}',true),('${id(22)}','${id(2)}',true);
    insert into job_descriptions values
      ('${id(101)}','${id(1)}',null),('${id(102)}','${id(1)}','${id(11)}'),
      ('${id(103)}','${id(1)}','${id(11)}'),('${id(104)}','${id(2)}',null),
      ('${id(105)}',null,null);
    insert into job_description_subcategories values ('${id(103)}','${id(11)}'),('${id(103)}','${id(12)}');
  `);
  await db.exec(sql);
  const actor = async (role = "ADMIN", active = true) => {
    await db.query("select set_config('test.actor',$1,false),set_config('test.role',$2,false),set_config('test.active',$3,false)", [id(999), role, String(active)]);
  };
  await actor();
  await db.exec("set role authenticated");
  const query = async (statement, args = []) => (await db.query(statement, args)).rows[0]?.result;
  const list = () => query("select read_tailoring_prompts_v1() as result");
  const detail = prompt => query("select read_tailoring_prompts_v1($1) as result", [prompt.id]);
  const preview = job => query("select preview_tailoring_prompt_v1($1) as result", [id(job)]);
  const create = (scope, primary = null, sub = null, priority = 0, name = "Prompt", body = "Write concise bullets.") => query(`
    select manage_tailoring_prompt_v1(p_action=>'CREATE',p_scope=>$1,p_primary_category_id=>$2,
      p_subcategory_id=>$3,p_priority=>$4,p_name=>$5,p_body=>$6) as result`,
    [scope, primary ? id(primary) : null, sub ? id(sub) : null, priority, name, body]);
  const mutate = (prompt, action, version = null) => query(`select manage_tailoring_prompt_v1(
    p_action=>$1,p_prompt_id=>$2,p_expected_revision=>$3,p_version=>$4) as result`, [action,prompt.id,prompt.revision,version]);
  const save = (prompt, body, priority = prompt.draft_priority) => query(`select manage_tailoring_prompt_v1(
    p_action=>'SAVE',p_prompt_id=>$1,p_expected_revision=>$2,p_name=>$3,p_body=>$4,p_priority=>$5) as result`,
    [prompt.id,prompt.revision,prompt.draft_name,body,priority]);
  let generic, primary, java, csharp;

  await t.test("Generic v1 seed exactly matches milestone 1 and is always available", async () => {
    const prompts = await list();
    assert.equal(prompts.length, 1);
    assert.equal("draft_body" in prompts[0], false);
    generic = await detail(prompts[0]);
    // A Windows checkout gives the migration CRLF line endings; the seeded text is otherwise identical.
    assert.equal(generic.versions[0].body.replace(/\r\n/g, "\n"), baseline);
    assert.equal(generic.versions[0].contract_version, "1");
    assert.equal(generic.events[0].action, "SEED");
    assert.equal((await preview(101)).scope, "GENERIC");
    assert.equal((await preview(105)).scope, "GENERIC");
    await assert.rejects(() => mutate(generic,"ARCHIVE"), /PROMPT_FALLBACK_REQUIRED/);
    const duplicate = await create("GENERIC");
    await assert.rejects(() => mutate(duplicate,"PUBLISH"), /PROMPT_CONFLICT/);
    assert.equal((await detail(duplicate)).versions.length, 0);
  });

  await t.test("invalid scopes, inactive categories, wrong subtype parents, and blank bodies are rejected", async () => {
    for (const args of [["UNKNOWN"],["GENERIC",1],["PRIMARY"],["SUBTYPE",1],["PRIMARY",11],
      ["PRIMARY",3],["SUBTYPE",1,21],["SUBTYPE",1,13],["PRIMARY",1,null,-1],
      ["PRIMARY",1,null,0,"Name"," "]]) {
      await assert.rejects(() => create(...args), /PROMPT_INVALID/);
    }
    await assert.rejects(() => preview(9999), /PROMPT_JOB_NOT_FOUND/);
  });

  await t.test("only published matching prompts are selected; subtype specificity outranks default priority", async () => {
    primary = await create("PRIMARY",1,null,100000,"Software default");
    java = await create("SUBTYPE",1,11,10,"Java");
    csharp = await create("SUBTYPE",1,12,20,"C#");
    assert.equal((await preview(103)).scope,"GENERIC");
    primary = await mutate(primary,"PUBLISH");
    assert.equal((await preview(103)).promptId,primary.id);
    java = await mutate(java,"PUBLISH");
    csharp = await mutate(csharp,"PUBLISH");
    assert.equal((await preview(102)).promptId,java.id, "legacy single subtype is supported");
    assert.equal((await preview(103)).promptId,csharp.id, "higher priority among ALL JD subtype tags wins");
    assert.equal((await preview(101)).promptId,primary.id);
    assert.equal((await preview(104)).promptId,generic.id);
  });

  await t.test("saving a draft leaves live content/priority unchanged; stale writes and publication fail", async () => {
    const old = csharp;
    csharp = await save(csharp,"New draft, not live.",5);
    assert.equal((await preview(103)).priority,20);
    assert.notEqual((await preview(103)).instructions,csharp.draft_body);
    await assert.rejects(() => save(old,"Stale edit"), /PROMPT_STALE/);
    await assert.rejects(() => mutate(old,"PUBLISH"), /PROMPT_STALE/);
    await assert.rejects(() => mutate(old,"ARCHIVE"), /PROMPT_STALE/);
    csharp = await mutate(csharp,"PUBLISH");
    assert.equal(csharp.published_version,2);
    assert.equal((await preview(103)).promptId,java.id);
    assert.equal(csharp.versions[1].body,old.draft_body);
  });

  await t.test("scope and priority conflicts leave no partial version or event behind", async () => {
    const duplicate = await create("SUBTYPE",1,11,30);
    await assert.rejects(() => mutate(duplicate,"PUBLISH"), /PROMPT_CONFLICT/);
    assert.equal((await detail(duplicate)).versions.length,0);
    const tie = await save(csharp,"Conflicting priority",10);
    await assert.rejects(() => mutate(tie,"PUBLISH"), /PROMPT_CONFLICT/);
    assert.equal((await detail(tie)).versions.length,2);
    assert.equal((await preview(103)).promptId,java.id);
    csharp = tie;
  });

  await t.test("restore publishes a new immutable version; archive falls back without deleting history", async () => {
    await assert.rejects(() => mutate(csharp,"RESTORE",999), /PROMPT_VERSION_NOT_FOUND/);
    csharp = await mutate(csharp,"RESTORE",1);
    assert.equal(csharp.published_version,3);
    assert.equal(csharp.versions[0].restored_from_version,1);
    assert.equal(csharp.versions[0].body,csharp.versions[2].body);
    assert.equal((await preview(103)).promptId,csharp.id);
    csharp = await mutate(csharp,"ARCHIVE");
    assert.equal((await preview(103)).promptId,java.id);
    java = await mutate(java,"ARCHIVE");
    assert.equal((await preview(103)).promptId,primary.id);
    primary = await mutate(primary,"ARCHIVE");
    assert.equal((await preview(103)).promptId,generic.id);
    assert.equal((await detail(csharp)).versions.length,3);
    assert.ok(csharp.events.some(e => e.action==='RESTORE' && e.actor_id===id(999)));
  });

  await t.test("competing publications allow exactly one same-priority winner", async () => {
    const a = await create("SUBTYPE",2,21,77), b = await create("SUBTYPE",2,22,77);
    const results = await Promise.allSettled([mutate(a,"PUBLISH"),mutate(b,"PUBLISH")]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(String(results.find(r=>r.status==='rejected').reason),/PROMPT_CONFLICT/);
    assert.equal((await detail(a)).versions.length+(await detail(b)).versions.length,1);
    const stale = await detail(a);
    const edits = await Promise.allSettled([save(stale,"First edit"),save(stale,"Second edit")]);
    assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
    assert.match(String(edits.find(r=>r.status==='rejected').reason),/PROMPT_STALE/);
  });

  await t.test("inactive taxonomy is ignored at selection and rejected at publication", async () => {
    java = await mutate(java,"RESTORE",1);
    assert.equal((await preview(102)).promptId,java.id);
    await db.exec(`reset role; update categories set active=false where id='${id(11)}'; set role authenticated;`);
    assert.equal((await preview(102)).scope,"GENERIC");
    await assert.rejects(() => mutate(java,"RESTORE",1), /PROMPT_INVALID/);
  });

  await t.test("RLS, RPC permissions, immutable history, and inactive-user checks are enforced", async () => {
    await assert.rejects(() => db.query("update tailoring_prompt_versions set body='tampered'"), /permission denied/);
    await assert.rejects(() => db.query("delete from tailoring_prompt_definitions"), /permission denied/);
    await assert.rejects(() => query("select select_tailoring_prompt_v1($1) as result",[id(101)]), /permission denied/);
    await db.exec("reset role");
    await assert.rejects(() => db.query("update tailoring_prompt_versions set body='tampered'"), /PROMPT_IMMUTABLE/);
    await assert.rejects(() => db.query("delete from tailoring_prompt_events"), /PROMPT_IMMUTABLE/);
    await db.exec("set role authenticated");
    await actor("APPLIER");
    assert.equal((await db.query("select * from tailoring_prompt_definitions")).rows.length,0);
    for (const attempt of [list,()=>detail(generic),()=>create("GENERIC"),()=>preview(101)]) {
      await assert.rejects(attempt,/PROMPT_FORBIDDEN/);
    }
    await actor("ADMIN",false);
    await assert.rejects(list,/PROMPT_FORBIDDEN/);
    await actor("APPLYING_MANAGER");
    assert.ok((await list()).length>0);
    await db.exec("reset role; set role anon");
    await assert.rejects(list,/permission denied/);
  });
});
