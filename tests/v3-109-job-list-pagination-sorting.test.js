import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL(
  "../supabase/migrations/202609231500_v3_109_job_list_pagination_sorting.sql", import.meta.url,
), "utf8");
const actor = "00000000-0000-4000-8000-000000000001";

test("JD list pagination and sorting execute correctly in PostgreSQL", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function public.is_active_user(uuid) returns boolean language sql as $$ select true $$;
    create function public.has_any_role(text[], uuid) returns boolean language sql as $$
      select current_setting('test.role', true) = any($1)
    $$;
    create function public.has_role(text, uuid) returns boolean language sql as $$
      select current_setting('test.role', true) = $1
    $$;
    create table public.categories(id uuid primary key, name text);
    create table public.industry_domain_categories(id uuid primary key, name text);
    create table public.job_descriptions(
      id uuid primary key, user_id uuid, company text, job_title text,
      category_id uuid, subcategory_id uuid, industry_domain_category_id uuid,
      seniority text, location_text text, work_arrangement text, source_site text,
      source_url text, normalized_source_url text, status text, review_status text,
      review_comment text, review_decline_reason text, reviewed_by uuid,
      reviewed_at timestamptz, application_blocked_at timestamptz,
      application_blocked_notes text, application_blocked_from_application_id uuid,
      created_at timestamptz, updated_at timestamptz, search_vector tsvector
    );
    create table public.applications(assigned_to uuid, job_description_id uuid);
    create table public.job_description_subcategories(
      id uuid, job_description_id uuid, subcategory_id uuid, sort_order integer
    );
    insert into public.job_descriptions(
      id, user_id, company, job_title, category_id, subcategory_id, seniority,
      source_url, status, review_status, created_at
    ) select
      lpad(n::text, 32, '0')::uuid,
      lpad((n % 3 + 1)::text, 32, '0')::uuid,
      'Company ' || (n % 17), 'Title ' || (n % 13),
      case when n % 7 <> 0 then lpad((n % 4 + 1)::text, 32, '0')::uuid end,
      case when n % 5 <> 0 then lpad((n % 6 + 1)::text, 32, '0')::uuid end,
      (array['JUNIOR', 'MID', 'SENIOR'])[n % 3 + 1],
      case when n % 9 <> 0 then 'https://jobs.test/' || (n % 11) end,
      case when n % 2 = 0 then 'ACTIVE' else 'ARCHIVED' end,
      (array['APPROVED', 'NEEDS_REVIEW', 'DECLINED'])[n % 3 + 1],
      '2026-09-01'::timestamptz + (n % 19) * interval '1 hour'
    from generate_series(1, 1205) n;
    select set_config('test.actor', '${actor}', false);
    select set_config('test.role', 'ADMIN', false);
  `);
  await db.exec(migration);
  const list = async (limit, offset = 0, sort = "created_desc") => {
    const { rows } = await db.query(`select public.list_job_descriptions_v396(
      p_limit => $1, p_offset => $2, p_sort => $3, p_status => 'ALL'
    ) as result`, [limit, offset, sort]);
    return rows[0].result;
  };
  const ids = (result) => result.items.map((row) => row.id);

  await t.test("500/1000-row pages have no missing or duplicate JDs", async () => {
    const { rows } = await db.query("select id from job_descriptions order by created_at desc nulls last, id desc");
    for (const size of [500, 1000]) {
      const actual = [];
      for (let offset = 0; offset < rows.length; offset += size) {
        const page = await list(size, offset);
        assert.equal(page.total, 1205);
        assert.equal(page.items.length, Math.min(size, 1205 - offset));
        actual.push(...ids(page));
      }
      assert.deepEqual(actual, rows.map((row) => row.id));
      assert.equal(new Set(actual).size, 1205);
    }
    assert.equal((await list(5000)).items.length, 1000, "direct callers remain bounded");
  });

  await t.test("all 20 sort directions survive JSON aggregation and page boundaries", async () => {
    const columns = {
      company: "lower(company)", title: "lower(job_title)", category: "category_id::text",
      subcategory: "subcategory_id::text", seniority: "seniority",
      source: "lower(coalesce(source_url, ''))", capturer: "user_id::text",
      status: "status", review: "review_status", created: "created_at",
    };
    for (const [key, expression] of Object.entries(columns)) {
      for (const direction of ["asc", "desc"]) {
        const sort = `${key}_${direction}`;
        const { rows } = await db.query(`select id from job_descriptions
          order by ${expression} ${direction} nulls last, id desc`);
        const actual = [];
        for (const offset of [0, 500, 1000]) actual.push(...ids(await list(500, offset, sort)));
        assert.deepEqual(actual, rows.map((row) => row.id), sort);
      }
    }
  });

  await t.test("out-of-range pages return the last valid page, including after deletion", async () => {
    assert.deepEqual(await list(500, 100000), await list(500, 1000));
    await db.exec("begin; delete from job_descriptions where id > lpad('1000', 32, '0')::uuid");
    const last = await list(500, 1000);
    assert.equal(last.total, 1000);
    assert.equal(last.items.length, 500);
    assert.deepEqual(last, await list(500, 500));
    await db.exec("delete from job_descriptions");
    assert.deepEqual(await list(500, 1000), { total: 0, items: [] });
    await db.exec("rollback");
  });

  await t.test("filters and caller visibility remain enforced", async () => {
    const { rows } = await db.query(`select public.list_job_descriptions_v396(
      p_company => 'Company 16', p_status => 'ACTIVE', p_limit => 1000
    ) as result`);
    assert.ok(rows[0].result.items.length > 0);
    assert.ok(rows[0].result.items.every((row) => row.company === 'Company 16' && row.status === 'ACTIVE'));
    await db.exec(`
      insert into applications select '${actor}', id from job_descriptions limit 3;
      select set_config('test.role', 'APPLIER', false);
    `);
    const visible = await list(1000);
    assert.equal(visible.total, 3);
    assert.equal(visible.items.length, 3);
    await db.exec("select set_config('test.actor', '', false)");
    await assert.rejects(() => list(1000), /JOB_LIST_FORBIDDEN/);
  });
});
