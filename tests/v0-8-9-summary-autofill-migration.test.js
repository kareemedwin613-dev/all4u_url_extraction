import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const sql=(await readFile(new URL("../supabase/migrations/202607290027_v0_8_9_resume_summary_autofill.sql",import.meta.url),"utf8")).toLowerCase();

test("verified Application-scoped Autofill context includes the Resume summary",()=>{
  assert.match(sql,/'candidate\.summary',nullif\(btrim\(coalesce\(r\.structured_content->>'summary'/);
  assert.match(sql,/'candidate\.firstname',coalesce[\s\S]*split_part\(btrim\(r\.candidate_name\)/);
  assert.match(sql,/'candidate\.lastname',coalesce[\s\S]*regexp_replace\(btrim\(r\.candidate_name\)/);
  assert.match(sql,/s\.user_id=auth\.uid\(\)/);
  assert.match(sql,/s\.action='autofill'/);
  assert.match(sql,/v_review_status<>'verified'/);
  assert.match(sql,/grant execute on function public\.get_application_autofill_context_v089[\s\S]*authenticated/);
  assert.doesNotMatch(sql,/service_role/);
});
