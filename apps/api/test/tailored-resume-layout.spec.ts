import test from "node:test";
import assert from "node:assert/strict";
import { renderedSkillGroups, resolveResumeHeadline, roleEnvironment } from "../src/platform/tailored-resume-layout.js";
import { renderTailoredResumePdf } from "../src/platform/tailored-resume-pdf.renderer.js";

test("the headline comes from the job title, capped at seniority, then the manager's fallback", () => {
  assert.equal(resolveResumeHeadline({ targetJob: { title: "Staff Data Engineer (Remote)", company: "Acme" }, resumeSeniority: "SENIOR", resumeHeadline: "Data Engineer" }), "Senior Data Engineer");
  assert.equal(resolveResumeHeadline({ targetJob: { title: "Engineering Manager, Data", company: "Acme" }, resumeSeniority: "SENIOR", resumeHeadline: " Senior  Data Engineer " }), "Senior Data Engineer");
  assert.equal(resolveResumeHeadline({ targetJob: { title: "Engineering Manager, Data" }, resumeSeniority: "SENIOR" }), null);
  assert.equal(resolveResumeHeadline({}), null);
});

test("skills are trimmed to the most relevant and grouped with the most relevant group first", () => {
  const skills = ["Snowflake", "Python", "dbt", ...Array.from({ length: 40 }, (_, index) => `Tool ${index}`)];
  const groups = renderedSkillGroups(skills, [], 30);
  assert.equal(groups.flatMap(group => group.skills).length, 30);
  assert.equal(groups[0].name, "Data & Databases");
  assert.deepEqual(groups[0].skills, ["Snowflake"]);
  assert.ok(!groups.flatMap(group => group.skills).includes("Tool 39"));
});

test("a role's environment lists only final skills its own details name, in priority order", () => {
  const skills = ["AWS", "Python", "Snowflake", "Kubernetes", "Go", "SSIS"];
  const details = "Built SSIS and Python pipelines into Snowflake on AWS. Go-live support for analysts.";
  assert.deepEqual(roleEnvironment(skills, details), ["AWS", "Python", "Snowflake", "SSIS"]);
  assert.deepEqual(roleEnvironment(skills, "Supported Python scripts."), []);
});

test("the tailored PDF still renders on one page with the new layout", async () => {
  const bytes = await renderTailoredResumePdf({
    applicationNumber: 19, renderTemplateKey: "MODERN_V1", targetJob: { title: "Sr. Data Engineer II - Remote", company: "Acme" }, resumeSeniority: "SENIOR",
    candidate: { name: "Alex Example", email: "alex@example.com", phone: "555-0100", city: "Boston", stateRegion: "MA" },
    sourceStructuredContent: { professional_experience: [{ id: "exp-1", company: "Source Co", job_title: "Senior Data Engineer", experience_details: "Built Python and SSIS pipelines into Snowflake.", start_date: { year: 2021, month: 1 }, is_current: true }] },
    approvedPreview: { summary: "Senior data engineer building reliable pipelines.", professionalExperience: [{ sourceExperienceId: "exp-1", tailoredDetails: "- Built Python and SSIS pipelines into Snowflake." }], skills: ["Python", "Snowflake", "SSIS"] },
  });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal((bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 1);
});
