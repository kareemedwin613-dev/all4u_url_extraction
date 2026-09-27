import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202609271000_v3_125_tailoring_queue_updated_index.sql", import.meta.url), "utf8");
const service = await readFile(new URL("../apps/api/src/platform/platform.service.ts", import.meta.url), "utf8");

test("the tailoring queue's newest-first order is index-backed, with and without a status filter", () => {
  assert.match(service, /from\("tailoring_jobs"\)\.select\("[^"]+"\)\.order\("updated_at",\{ascending:false\}\)\.limit\(100\)/);
  assert.match(sql, /create index if not exists tailoring_jobs_updated_idx\s+on public\.tailoring_jobs \(updated_at desc, id\);/);
  assert.match(sql, /create index if not exists tailoring_jobs_status_updated_idx\s+on public\.tailoring_jobs \(status, updated_at desc, id\);/);
  assert.doesNotMatch(sql, /concurrently/i);
});
