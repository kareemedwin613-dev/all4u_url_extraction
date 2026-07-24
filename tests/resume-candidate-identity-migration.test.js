import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240014_resume_candidate_identity.sql",import.meta.url);

test("candidate identity migration stores and indexes email and phone",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/add column if not exists candidate_email text/i);
  assert.match(sql,/add column if not exists candidate_phone text/i);
  assert.match(sql,/resumes_candidate_identity_idx/i);
  assert.match(sql,/regexp_replace\(lower\(btrim\(candidate_name\)\)/i);
  assert.match(sql,/regexp_replace\(candidate_phone, '\[\^0-9\]'/i);
});

test("candidate identity lookup requires normalized name email and phone together",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/find_resume_identity_duplicates/i);
  assert.match(sql,/resumes\.candidate_name[\s\S]*= v_name/i);
  assert.match(sql,/resumes\.candidate_email[\s\S]*= v_email/i);
  assert.match(sql,/resumes\.candidate_phone[\s\S]*= v_phone/i);
  assert.match(sql,/security invoker/i);
  assert.doesNotMatch(sql,/service.role/i);
});
