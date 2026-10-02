import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609301800_v3_139_interviews.sql", import.meta.url),
  "utf8",
);

test("interview calendar stores meetings and rounds behind manager and applier checks", () => {
  assert.match(sql, /create table if not exists public\.interviews/);
  assert.match(sql, /create table if not exists public\.interview_rounds/);
  assert.match(sql, /application_id uuid references public\.applications/);
  assert.match(sql, /'RECRUITER', 'HIRING_MANAGER', 'TECH', 'FINAL'/);
  assert.match(sql, /'UPCOMING', 'COMPLETED', 'RESCHEDULED', 'NEEDS_FOLLOW_UP'/);
  assert.match(sql, /revoke all on table public\.interviews from public, anon, authenticated/);
  assert.match(sql, /interview_application_defaults_v139/);
  assert.match(sql, /list_interviews_v139/);
  assert.match(sql, /save_interview_v139/);
  assert.match(sql, /delete_interview_v139/);
  assert.match(sql, /grant execute on function public\.save_interview_v139\(jsonb\) to authenticated/);
  assert.match(sql, /INTERVIEW_APPLICATION_REQUIRED/);
  assert.match(sql, /interval '120 days'/);
  assert.match(sql, /https\?:\/\/\[\^\[:space:\]\]\+/);
});
