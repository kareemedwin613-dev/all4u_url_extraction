import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/202608110051_v2_3_resume_archival.sql",import.meta.url),"utf8");

test("Resume archive history is traceable, constrained, and indexed",()=>{
  assert.match(sql,/add column if not exists archived_at timestamptz/i);
  assert.match(sql,/add column if not exists archived_by uuid/i);
  assert.match(sql,/resumes_archive_audit_consistent/i);
  assert.match(sql,/resumes_original_archive_history_idx/i);
  assert.match(sql,/foreign key \(archived_by\) references public\.profiles\(id\) on delete restrict/i);
});

test("archive mutation is manager-authorized, original-only, and non-destructive",()=>{
  assert.match(sql,/create or replace function public\.set_resume_archived_state_v23/i);
  assert.match(sql,/perform public\.assert_application_manager\(\)/i);
  assert.match(sql,/resume_type <> 'ORIGINAL'/i);
  assert.match(sql,/update public\.resumes\s+set status = v_status/i);
  assert.doesNotMatch(sql,/delete from public\.resumes/i);
  assert.match(sql,/revoke all on function public\.set_resume_archived_state_v23\(uuid, text\) from public, anon/i);
});

test("archive audit fields cannot be forged by ordinary row updates",()=>{
  assert.match(sql,/new\.archived_at := clock_timestamp\(\)/i);
  assert.match(sql,/new\.archived_by := auth\.uid\(\)/i);
  assert.match(sql,/new\.archived_at := old\.archived_at/i);
  assert.match(sql,/before update of status, archived_at, archived_by/i);
});
