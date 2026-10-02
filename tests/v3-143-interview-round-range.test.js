import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011600_v3_143_interview_round_range.sql", import.meta.url),
  "utf8",
);

test("interview rounds store a from and to time", () => {
  assert.match(sql, /add column if not exists ends_at timestamptz/);
  assert.match(sql, /ends_at > starts_at/);
  assert.match(sql, /'endsAt', r\.ends_at/);
  assert.match(sql, /Enter both a start and an end time for each round/);
});
