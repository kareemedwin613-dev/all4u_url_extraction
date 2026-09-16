import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("JD Finder is a fixed assignable role across shared and Admin contracts",async()=>{
  const[contracts,codes,dto,migration]=await Promise.all([
    read("../packages/contracts/src/index.ts"),read("../dashboard/src/access/role-codes.js"),read("../apps/api/src/platform/platform.dto.ts"),read("../supabase/migrations/202608030043_jd_finder_role.sql")
  ]);
  for(const source of[contracts,codes,dto,migration])assert.match(source,/JD_FINDER/);
  assert.match(migration,/active,is_system\)[\s\S]*true,true\)/);
});

test("JD Finder can capture and read owned JDs without broader operational access",async()=>{
  const[ingestion,lookups,jobs,applications,resumes]=await Promise.all([
    read("../apps/api/src/extension-ingestion/job-description.controller.ts"),read("../apps/api/src/lookups/lookup.controller.ts"),read("../apps/api/src/job-descriptions/job-description-read.controller.ts"),read("../apps/api/src/applications/application.controller.ts"),read("../apps/api/src/resumes/resume.controller.ts")
  ]);
  assert.match(ingestion,/RequireRoles\("APPLYING_MANAGER", "JD_FINDER", "ADMIN"\)/);
  assert.match(lookups,/"JD_FINDER"/);
  assert.match(jobs,/"JD_FINDER"/);
  assert.doesNotMatch(applications,/JD_FINDER/);
  assert.doesNotMatch(resumes,/JD_FINDER/);
});

test("JD Finder RLS permits own capture writes without update or delete; shared catalog read is v3.97",async()=>{
  const[original,shared]=await Promise.all([
    read("../supabase/migrations/202608030043_jd_finder_role.sql"),
    read("../supabase/migrations/202609161400_v3_97_jd_finder_full_jd_read.sql"),
  ]);
  assert.match(original,/"jd finders insert own jobs"[\s\S]*for insert[\s\S]*has_role\('JD_FINDER'\)[\s\S]*user_id=\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(original,/for update|for delete/i);
  assert.match(shared,/has_any_role\(array\['APPLYING_MANAGER','ADMIN','JD_FINDER'\]\)/);
  assert.match(shared,/drop policy if exists "jd finders read own jobs"/);
});
