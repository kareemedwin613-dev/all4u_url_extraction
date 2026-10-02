import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011200_v3_140_interviewee_role.sql", import.meta.url),
  "utf8",
);

test("Interviewee is a system role and interviews point at that user", () => {
  assert.match(sql, /'INTERVIEWEE'/);
  assert.match(sql, /Attends scheduled interviews/);
  assert.match(sql, /interviewee_user_id uuid references public\.profiles/);
  assert.match(sql, /INTERVIEWEE_REQUIRED/);
  assert.match(sql, /list_interviewee_users_v140/);
  assert.match(sql, /has_role\('INTERVIEWEE', auth\.uid\(\)\)/);
  assert.match(sql, /drop function if exists public\.interview_row_visible\(uuid, uuid, uuid\)/);
});
