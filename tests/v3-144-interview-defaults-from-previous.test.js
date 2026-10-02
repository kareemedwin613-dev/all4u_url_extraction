import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011700_v3_144_interview_defaults_from_previous.sql", import.meta.url),
  "utf8",
);

test("the next interview copies interviewee, company website, and job type from the previous round", () => {
  assert.match(sql, /i\.interviewee_user_id/);
  assert.match(sql, /i\.company_website/);
  assert.match(sql, /i\.job_type in \('FULL_TIME', 'PART_TIME', 'CONTRACT'\)/);
  assert.match(sql, /order by i\.created_at desc/);
});
