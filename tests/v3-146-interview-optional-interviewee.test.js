import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011900_v3_146_interview_optional_interviewee.sql", import.meta.url),
  "utf8",
);

test("an interview can be saved without an interviewee", () => {
  assert.match(sql, /alter column interviewee_name drop not null/);
  assert.match(sql, /if v_interviewee_id is not null then/);
  assert.match(sql, /INTERVIEWEE_REQUIRED/);
});
