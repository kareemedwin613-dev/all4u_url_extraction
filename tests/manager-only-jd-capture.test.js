import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const legacy = read("../supabase/migrations/202609201300_v3_105_catalog_wide_jd_duplicates.sql");
const migration = read("../supabase/migrations/202609271200_v3_127_manager_only_jd_capture.sql");
const actorId = "00000000-0000-4000-8000-000000000001";

test("capture UI separates duplicate permission and guards form submission against banned companies", () => {
  const view = read("../extension/sidepanel/views/CaptureView.jsx");
  assert.match(view, /disabled=\{!canCheckDuplicates \|\| saving \|\| extracting\}/);
  assert.match(view, /async function submit\(\) \{\s*if \(!canWrite\)/);
  assert.match(view, /disabled=\{\s*!canWrite\s*\|\|\s*checkingDuplicate\s*\|\|\s*Boolean\(bannedResult\?\.match\)\s*\}/);
  assert.match(view, /An Admin or Applying Manager must save this JD/);
  assert.match(read("../extension/sidepanel/App.jsx"), /canCheckDuplicates=\{canCheckJobDuplicates\(access\)\}/);
});

test("database denies Finder saves through RPC and direct insert but preserves duplicate checks", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor'),'')::uuid $$;
    create function is_active_user(uuid) returns boolean language sql stable as $$ select $1 is not null and current_setting('test.active')='true' $$;
    create function has_role(text) returns boolean language sql stable as $$ select is_active_user(auth.uid()) and $1=any(string_to_array(current_setting('test.roles'),',')) $$;
    create function has_any_role(text[]) returns boolean language sql stable as $$ select is_active_user(auth.uid()) and $1 && string_to_array(current_setting('test.roles'),',') $$;
    create table profiles(id uuid primary key,full_name text,email text);
    create table job_descriptions(
      id uuid primary key default gen_random_uuid(), user_id uuid, company text, job_title text,
      category_id uuid,subcategory_id uuid,industry_domain_category_id uuid,seniority text,location_text text,
      work_arrangement text,clearance_requirements text[],travel_required boolean,travel_details text,
      salary_min numeric,salary_max numeric,salary_currency text,salary_period text,salary_text text,
      source_site text,source_url text,normalized_source_url text,captured_at_client timestamptz,
      description_text text,detected_skills text[],capture_method text,extraction_confidence text,
      created_at timestamptz default now(),review_status text,status text
    );
    create function replace_job_description_subcategories(uuid,uuid,uuid[],boolean) returns void language sql as $$ select $$;
    create function job_description_subcategory_ids(uuid) returns uuid[] language sql as $$ select array[]::uuid[] $$;
    alter table job_descriptions enable row level security;
    grant usage on schema auth to authenticated;
    grant select,insert on job_descriptions to authenticated;
    create policy "read jobs" on job_descriptions for select to authenticated using(true);
  `);
  // Load the actual pre-existing insert policies, not a permissive test substitute.
  for (const [path, name] of [
    ["../supabase/migrations/202607270019_v0_7_1_performance_scalability.sql", "managers and admins insert jobs"],
    ["../supabase/migrations/202608030043_jd_finder_role.sql", "jd finders insert own jobs"],
  ]) {
    const definition = read(path).match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
    assert.ok(definition);
    await db.exec(definition[0]);
  }
  await db.exec(legacy);
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply.
  const actor = async (roles, active = true, id = actorId) => {
    await db.exec("reset role");
    await db.query("select set_config('test.roles',$1,false),set_config('test.active',$2,false),set_config('test.actor',$3,false)", [roles, String(active), id]);
    await db.exec("set role authenticated");
  };
  const capture = async (suffix = "new") => (await db.query("select capture_job_description_v353($1::jsonb) result", [JSON.stringify({
    company: "Example", job_title: `Engineer ${suffix}`, source_url: `https://example.test/${suffix}`,
    normalized_source_url: `https://example.test/${suffix}`, description_text: "A job description",
  })])).rows[0].result;
  const directInsert = () => db.query("insert into job_descriptions(user_id,company,job_title) values(auth.uid(),'Direct','Engineer')");
  const duplicate = async suffix => (await db.query("select check_job_description_duplicate_v3104('','',$1) result", [`https://example.test/${suffix}`])).rows[0].result;

  for (const roles of ["ADMIN", "APPLYING_MANAGER", "JD_FINDER,ADMIN", "JD_FINDER,APPLYING_MANAGER"]) {
    await actor(roles);
    assert.equal((await capture(roles)).duplicate, false);
    assert.equal((await capture(roles)).duplicate, true);
    await directInsert();
  }
  await actor("JD_FINDER");
  const before = (await db.query("select count(*)::int n from job_descriptions")).rows[0].n;
  assert.equal((await duplicate("ADMIN")).duplicate, true);
  assert.equal((await duplicate("missing")).duplicate, false);
  for (const roles of ["JD_FINDER", "JD_FINDER,APPLIER", "APPLIER", "DEVELOPER", "DEVELOPMENT_MANAGER", ""]) {
    await actor(roles);
    await assert.rejects(() => capture(), /JOB_CAPTURE_ACCESS_DENIED/);
    await assert.rejects(() => capture("ADMIN"), /JOB_CAPTURE_ACCESS_DENIED/);
    await assert.rejects(directInsert, /row-level security/);
  }
  for (const roles of ["JD_FINDER", "ADMIN", "APPLYING_MANAGER"]) {
    await actor(roles, false);
    await assert.rejects(() => capture(), /JOB_CAPTURE_ACCESS_DENIED/);
    await assert.rejects(directInsert, /row-level security/);
    await assert.rejects(() => duplicate("ADMIN"), /JOB_CAPTURE_ACCESS_DENIED/);
  }
  await actor("ADMIN", true, "");
  await assert.rejects(() => capture(), /JOB_CAPTURE_ACCESS_DENIED/);
  await db.exec("reset role; set role anon");
  await assert.rejects(() => capture(), /permission denied/);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from job_descriptions")).rows[0].n, before);
});
