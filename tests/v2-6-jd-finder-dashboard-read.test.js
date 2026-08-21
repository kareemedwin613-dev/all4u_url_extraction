import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/202608120054_v2_6_jd_finder_dashboard_read.sql",import.meta.url),"utf8");

test("JD Finder capturer options remain self-scoped",()=>{
  assert.match(migration,/JD_FINDER/);
  assert.match(migration,/jobs\.user_id=auth\.uid\(\)/i);
  assert.match(migration,/APPLIER.*APPLYING_MANAGER.*ADMIN/i);
});
