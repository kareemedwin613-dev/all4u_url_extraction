import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011400_v3_141_interview_notion_fields.sql", import.meta.url),
  "utf8",
);

test("interview records store the Notion fields and the expanded status and type lists", () => {
  assert.match(sql, /interviewer_position text/);
  assert.match(sql, /interviewer_location text/);
  assert.match(sql, /detailed_information text/);
  assert.match(sql, /'REJECTED', 'NOT_JOINED'/);
  assert.match(sql, /'GOOGLE_MEET'/);
  assert.match(sql, /'AI_INTERVIEW'/);
  assert.match(sql, /'FULL_TIME', 'PART_TIME', 'CONTRACT'/);
  assert.match(sql, /'REMOTE', 'ONSITE', 'HYBRID'/);
  assert.match(sql, /'linkedinUrl', r\.linkedin_url/);
  assert.match(sql, /'resumeId', r\.id/);
  assert.match(sql, /when 'ONSITE' then 'ONSITE'/);
});

test("profile name is stored separately from the interviewee user", async () => {
  const next = await readFile(
    new URL("../supabase/migrations/202610011500_v3_142_interview_profile_name.sql", import.meta.url),
    "utf8",
  );
  assert.match(next, /profile_name text/);
  assert.match(next, /'profileName', r\.candidate_name/);
  assert.match(next, /p_payload->>'profileName'/);
});
