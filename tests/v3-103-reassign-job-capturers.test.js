import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/202609201100_v3_103_reassign_job_capturers.sql", import.meta.url),
  "utf8",
);

test("v3.103 capturer reassignment is manager-authorized and uniqueness-safe", () => {
  assert.match(sql, /create table if not exists public\.job_description_capturer_history/i);
  assert.match(sql, /create or replace function public\.list_job_capturer_candidates_v3103/i);
  assert.match(sql, /create or replace function public\.bulk_reassign_job_description_capturers_v3103/i);
  assert.match(sql, /perform public\.assert_application_manager\(\)/i);
  assert.match(sql, /r\.code in \('JD_FINDER', 'APPLYING_MANAGER', 'ADMIN'\)/i);
  assert.match(sql, /normalized_source_url = v_job\.normalized_source_url/i);
  assert.match(sql, /insert into public\.job_description_capturer_history/i);
  assert.match(sql, /set\s+user_id = p_new_user_id/i);
  assert.match(sql, /cardinality\(v_ids\) > 1000/i);
  assert.match(
    sql,
    /revoke all on function public\.bulk_reassign_job_description_capturers_v3103\(uuid\[\], uuid, text\) from public, anon/i,
  );
});
