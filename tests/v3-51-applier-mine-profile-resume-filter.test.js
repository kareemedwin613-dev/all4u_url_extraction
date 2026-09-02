import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatMineResumeOptionLabel } from "../extension/services/application-service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("v3.51 groups My Applications resume filter options by ORIGINAL profile", () => {
  const sql = read("../supabase/migrations/202609021115_v3_51_applier_mine_profile_resume_filter.sql");
  assert.match(sql, /coalesce\(r\.parent_resume_id, r\.id\) profile_resume_id/);
  assert.match(sql, /join public\.resumes profile_r on profile_r\.id = coalesce\(r\.parent_resume_id, r\.id\)/);
  assert.match(sql, /group by profile_resume_id, profile_resume_name, profile_resume_number, profile_candidate_name/);
  assert.match(sql, /profile_resume_id = p_resume_id/);
  assert.match(sql, /'candidateName', candidate_name/);
});

test("extension resume filter uses profile labels and searchable virtual select", () => {
  const view = read("../extension/sidepanel/views/MyApplicationsView.jsx");
  assert.match(view, /All profiles/);
  assert.match(view, /formatMineResumeOptionLabel/);
  assert.match(view, /virtual/);
  assert.match(view, /Search candidate or profile/);
});

test("formatMineResumeOptionLabel prefers candidate plus profile resume name", () => {
  assert.equal(
    formatMineResumeOptionLabel({
      candidateName: "Andrew Thomas",
      resumeName: "Andrew Thomas Resume",
      resumeNumber: 12,
    }),
    "Andrew Thomas · Andrew Thomas Resume #12",
  );
});
