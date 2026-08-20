import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql=await readFile(new URL("../supabase/migrations/202608120055_v2_7_jd_review_workflow.sql",import.meta.url),"utf8");
const view=await readFile(new URL("../extension/sidepanel/views/JobReviewView.jsx",import.meta.url),"utf8");
assert.match(view,/Number\(result\?\.total\)\|\|0/);
assert.match(view,/the next batch loads automatically/);
assert.match(view,/listJobReviews\(client,backendBaseUrl,activeFilters\(\)\)/);
assert.doesNotMatch(view,/\$\{items\.length\} JD/);

test("v2.7 has a four-state audited manager review workflow without under-review",()=>{
  for(const status of ["NEEDS_REVIEW","APPROVED","NEEDS_CORRECTION","DECLINED"])assert.match(sql,new RegExp(status));
  assert.doesNotMatch(sql,/UNDER_REVIEW/);
  assert.match(sql,/job_description_review_history/);
  assert.match(sql,/job_description_review_history enable row level security/);
  assert.match(sql,/revoke insert,update,delete on public\.job_description_review_history from authenticated/);
  assert.match(sql,/assert_application_manager\(\)/);
  assert.match(sql,/review_job_description_v27/);
});

test("new finder captures need review and only approved active JDs can create Applications",()=>{
  assert.match(sql,/new\.review_status := 'NEEDS_REVIEW'/);
  assert.match(sql,/status='ACTIVE' and review_status='APPROVED'/);
  assert.match(sql,/j\.status='ACTIVE' and j\.review_status='APPROVED'/);
});

test("extension review UI uses one-card decisions and queue filters",()=>{
  for(const text of ["Approve & next","Needs correction","Decline","Captured by","Today","This week","This month"])assert.match(view,new RegExp(text));
  assert.match(view,/Open job posting/);
  assert.match(view,/reviewJob/);
  assert.match(view,/current\.category_name \|\| "Uncategorized"/);
});
