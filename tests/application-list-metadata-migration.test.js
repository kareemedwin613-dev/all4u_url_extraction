import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240013_application_list_applier_metadata.sql",import.meta.url);

test("Application list metadata migration exposes role-priority display fields",async()=>{
  const sql=await readFile(migration,"utf8");
  for(const field of ["resume_name","candidate_name","source_url","captured_at","category_name","assignee_name"])assert.match(sql,new RegExp(field,"i"));
  assert.match(sql,/j\.created_at as captured_at/i);
  assert.match(sql,/join public\.resumes/i);
});

test("Application list metadata migration preserves RPC access controls",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/security definer/i);
  assert.match(sql,/v_manager or a\.assigned_to = auth\.uid\(\)/i);
  assert.match(sql,/revoke all on function public\.list_applications/i);
  assert.match(sql,/grant execute on function public\.list_applications[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql,/service.role/i);
});
