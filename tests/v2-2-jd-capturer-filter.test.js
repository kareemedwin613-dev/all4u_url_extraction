import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/202608110050_v2_2_jd_capturer_filter.sql", import.meta.url), "utf8");

test("capturer options are role checked and expose only grouped JD attribution", () => {
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.match(sql, /has_any_role\(array\['APPLIER', 'APPLYING_MANAGER', 'ADMIN'\]\)/i);
  assert.match(sql, /from public\.job_descriptions as jobs/i);
  assert.match(sql, /group by jobs\.user_id/i);
  assert.match(sql, /count\(\*\)::bigint/i);
});

test("capturer options are unavailable to anonymous callers", () => {
  assert.match(sql, /revoke all on function public\.list_job_description_capturers\(\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.list_job_description_capturers\(\) to authenticated/i);
});
