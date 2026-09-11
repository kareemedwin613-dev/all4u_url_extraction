import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, applyMatchingPrimaryCandidates, RESUME, PRIMARY } from "./database-helper.mjs";

const migration = await readFile(new URL("../../../supabase/migrations/202609101000_v3_70_application_matching.sql", import.meta.url), "utf8");

test("migration preflights all DDL locks without waiting before its first schema change", () => {
  const firstChange = migration.indexOf("create table public.application_match_settings");
  const preflight = migration.slice(0, firstChange);
  assert.match(preflight, /lock table public\.applications, public\.job_descriptions, public\.resumes\s+in access exclusive mode nowait;/i);
  assert.match(preflight, /lock table public\.profiles in share row exclusive mode nowait;/i);
  assert.match(preflight, /set local lock_timeout = '3s';/i);
  assert.match(preflight, /MATCHING_MIGRATION_BUSY/);
  assert.match(preflight, /errcode='55P03'/);
  assert.doesNotMatch(migration, /pg_(?:terminate|cancel)_backend|disable trigger|session_replication_role/i);
});

for (const lastArgument of ["p_subcategory_id", "p_job_description_id"]) {
  test(`migration preserves the existing ${lastArgument} signature, defaults and dependent objects`, async t => {
    const { pg } = await database({ applyMatchingMigrations: false });
    t.after(() => pg.close());
    // Reproduce both v3.68's local signature and the verified deployed signature.
    await pg.exec(`create function public.resume_matches_job_for_bulk(p_resume_id uuid,p_category_id uuid,${lastArgument} uuid default null)
      returns boolean language sql stable as $$ select false $$;
      revoke all on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) from public,anon;
      grant execute on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) to authenticated;
      create view public.legacy_match_dependency as select public.resume_matches_job_for_bulk(
        p_resume_id=>'${RESUME}'::uuid,p_category_id=>null,${lastArgument}=>null) as available;`);
    const signature = async () => (await pg.query(`select oid,proargnames,pg_get_function_arguments(oid) as args
      from pg_proc where oid='public.resume_matches_job_for_bulk(uuid,uuid,uuid)'::regprocedure`)).rows[0];
    const before = await signature();
    // Demonstrate that the former fixed declaration fails for the deployed variant.
    if (lastArgument === "p_job_description_id") await assert.rejects(() => pg.exec(`
      create or replace function public.resume_matches_job_for_bulk(p_resume_id uuid,p_category_id uuid,p_subcategory_id uuid default null)
      returns boolean language sql stable as $$ select true $$;`), error => error.code === "42P13");
    await pg.transaction(tx => tx.exec(migration));
    for (const file of ["202609101010_v3_71_application_matching_preview.sql", "202609101020_v3_72_application_matching_create.sql"]) {
      const sql = await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8");
      await pg.transaction(tx => tx.exec(sql));
    }
    assert.deepEqual(await signature(), before);
    assert.equal((await pg.query("select available from public.legacy_match_dependency")).rows[0].available, true);
    assert.equal((await pg.query("select public.resume_matches_job_for_bulk($1,null) as available", [RESUME])).rows[0].available, true);
    await applyMatchingPrimaryCandidates(pg);
    assert.deepEqual(await signature(),before);
    assert.equal((await pg.query('select available from public.legacy_match_dependency')).rows[0].available,false);
    assert.equal((await pg.query('select public.resume_matches_job_for_bulk($1,$2) as available',[RESUME,PRIMARY])).rows[0].available,true);
    await pg.query("update resumes set status='ARCHIVED' where id=$1", [RESUME]);
    assert.equal((await pg.query("select available from public.legacy_match_dependency")).rows[0].available, false);
    assert.equal((await pg.query(`select has_function_privilege('authenticated','public.resume_matches_job_for_bulk(uuid,uuid,uuid)','execute') as allowed`)).rows[0].allowed, true);
    assert.equal((await pg.query(`select has_function_privilege('anon','public.resume_matches_job_for_bulk(uuid,uuid,uuid)','execute') as allowed`)).rows[0].allowed, false);
  });
}

test("a failed matching migration rolls back its schema and can be retried as one transaction", async t => {
  const { pg } = await database({ applyMatchingMigrations: false });
  t.after(() => pg.close());
  const before = (await pg.query("show lock_timeout")).rows[0].lock_timeout;
  const injectedFailure = migration.replace(
    "-- One authoritative gate, including direct SQL RPC creation and changes to a different pair.",
    "select 1 / 0;\n-- Deliberate test failure at the previously failing Application DDL boundary.",
  );
  assert.notEqual(injectedFailure, migration);
  await assert.rejects(() => pg.transaction(tx => tx.exec(injectedFailure)), error => error.code === "22012");
  const artifacts = await pg.query(`select table_name,column_name from information_schema.columns where table_schema='public'
    and (table_name like 'application_match_%' or column_name in('matching_hash','match_assessment_id','match_score','match_threshold'))`);
  assert.equal(artifacts.rows.length, 0);
  assert.equal((await pg.query("show lock_timeout")).rows[0].lock_timeout, before);
  await pg.transaction(tx => tx.exec(migration));
  assert.ok((await pg.query("select to_regclass('public.application_match_settings') as name")).rows[0].name);
  assert.equal((await pg.query("select count(*)::integer as n from resumes where matching_hash is null")).rows[0].n, 0);
  assert.equal((await pg.query("show lock_timeout")).rows[0].lock_timeout, before);
});
