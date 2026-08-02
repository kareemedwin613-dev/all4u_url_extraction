import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const sql=await readFile(new URL("../supabase/migrations/202607310030_v0_9_1_location_employer_sensitive_answers.sql",import.meta.url),"utf8");
test("v0.9.1 adds derived current location and current employer to the scoped Autofill context",()=>{
 assert.match(sql,/'candidate\.currentLocation'/);assert.match(sql,/address_city/);assert.match(sql,/'candidate\.currentCompany'/);assert.match(sql,/professional_experience/);assert.match(sql,/is_current/);
});
test("v0.9.1 permits only the three explicit voluntary categories and retains protected grants",()=>{
 for(const key of ["gender_identity","race_ethnicity","veteran_status"])assert.match(sql,new RegExp(key));
 assert.match(sql,/resume_answer_sensitive_patterns_valid_v091/);assert.match(sql,/jsonb_array_length\(p_answers\) not between 1 and 10/);assert.match(sql,/revoke all on function public\.get_application_autofill_context_v089/);assert.match(sql,/grant execute .* to authenticated/i);
});
