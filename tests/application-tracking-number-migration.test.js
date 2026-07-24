import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240015_application_tracking_number.sql",import.meta.url);

test("Application tracking migration assigns unique positive decimal numbers",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/create sequence if not exists public\.application_number_seq[\s\S]*as bigint/i);
  assert.match(sql,/add column if not exists application_number bigint/i);
  assert.match(sql,/set application_number = nextval/i);
  assert.match(sql,/application_number set not null/i);
  assert.match(sql,/unique \(application_number\)/i);
  assert.match(sql,/check \(application_number > 0\)/i);
  assert.match(sql,/no cycle/i);
});

test("Application list RPC returns and searches the tracking number without weakening access",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/select[\s\S]*a\.\*/i);
  assert.match(sql,/a\.application_number::text = v_number_search/i);
  assert.match(sql,/v_manager or a\.assigned_to = auth\.uid\(\)/i);
  assert.match(sql,/revoke all on function public\.list_applications/i);
  assert.doesNotMatch(sql,/service.role/i);
});
