import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/202608110053_v2_5_original_resume_application_scope.sql",import.meta.url),"utf8");

test("bulk Application preview exposes only active original Resumes",()=>{
  assert.match(sql,/resumes\.status='ACTIVE' and resumes\.resume_type='ORIGINAL'/i);
  assert.match(sql,/'resumeType',resume_type/i);
  assert.match(sql,/No active original Resumes have the same primary category/i);
});

test("bulk duplicate detection follows the original Resume family after tailoring",()=>{
  assert.match(sql,/coalesce\(\(select parent_resume_id from public\.resumes where id=applications\.resume_id\),applications\.resume_id\)=resumes\.id/i);
});
