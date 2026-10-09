import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { selectJobSiteAdapter } from "../extension/adapters/adapter-registry.js";
import { degreeLevel, detectWorkdaySections, isWorkdayHost, workdayAddButton, workdayEntries } from "../extension/autofill/workday.js";
import { repeatableSectionRows, sectionResultFields, splitSkills } from "../extension/autofill/autofill-context.js";
import { sanitizeSectionRows } from "../extension/autofill/repeatable-sections.js";
import { buildAutofillTelemetry } from "../extension/autofill/session-telemetry.js";

// Workday "My Experience" markup: entries carry ids like workExperience-1--jobTitle; dates are MM / YYYY boxes.
function page(extra = "") {
  const { document, window } = parseHTML(`<!doctype html><html><body>
    <div role="group" aria-labelledby="we"><h3 id="we">Work Experience</h3>
      <div role="group"><h4>Work Experience 1</h4>
        <label for="workExperience-1--jobTitle">Job Title*</label><input id="workExperience-1--jobTitle" value="Senior Software Engineer">
        <label for="workExperience-1--companyName">Company*</label><input id="workExperience-1--companyName" value="Initech">
        <label for="workExperience-1--location">Location</label><input id="workExperience-1--location">
        <input type="checkbox" id="workExperience-1--currentlyWorkHere">
        <input id="workExperience-1--startDate-dateSectionMonth-input" placeholder="MM"><input id="workExperience-1--startDate-dateSectionYear-input" placeholder="YYYY">
        <textarea id="workExperience-1--roleDescription"></textarea></div>
      <button type="button" data-automation-id="add-button">Add Another</button></div>
    <div role="group" aria-labelledby="ed"><h3 id="ed">Education</h3><button type="button" data-automation-id="add-button">Add</button></div>
    <div role="group" aria-labelledby="ws"><h3 id="ws">Websites</h3><button type="button" data-automation-id="add-button">Add</button></div>
    <div data-automation-id="formField-skills"><label for="skills--skills">Type to Add Skills</label><input id="skills--skills" placeholder="Search"></div>
    <button type="submit" data-automation-id="bottom-navigation-next-button">Save and Continue</button>${extra}
  </body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}

test("Workday sites use the Workday adapter", () => {
  assert.equal(isWorkdayHost("acme.wd1.myworkdayjobs.com"), true);
  assert.equal(isWorkdayHost("acme.wd5.myworkdaysite.com"), true);
  assert.equal(isWorkdayHost("myworkdayjobs.com.evil.example"), false);
  assert.equal(selectJobSiteAdapter("https://chghealthcare.wd1.myworkdayjobs.com/en-US/External/job/X/apply").adapter.id, "workday");
});

test("entries are read from Workday's ids, with each date's MM and YYYY boxes", () => {
  const entries = workdayEntries(page());
  assert.equal(entries.employment.length, 1);
  const fields = entries.employment[0].fields;
  assert.equal(fields.company.element.id, "workExperience-1--companyName");
  assert.equal(fields.startDate.month.id, "workExperience-1--startDate-dateSectionMonth-input");
  assert.equal(fields.startDate.year.id, "workExperience-1--startDate-dateSectionYear-input");
  assert.equal(fields.description.element.tagName, "TEXTAREA");
});

test("each section's Add button is found by its heading; Websites and Save and Continue are never used", () => {
  const document = page();
  assert.equal(workdayAddButton(document, "employment")?.textContent, "Add Another");
  assert.equal(workdayAddButton(document, "education")?.closest("[role=group]").getAttribute("aria-labelledby"), "ed");
  const named = page(`<button type="button" aria-label="Add Work Experience">Add</button>`);
  assert.ok(workdayAddButton(named, "employment"));
  assert.deepEqual(detectWorkdaySections(document).map((item) => [item.kind, item.existing]), [["employment", 1], ["education", 0], ["skills", 0]]);
});

test("Resume degrees are matched to Workday's degree levels", () => {
  assert.equal(degreeLevel("Bachelor of Science"), "bachelor");
  assert.equal(degreeLevel("B.S. Computer Science"), "bachelor");
  assert.equal(degreeLevel("MBA"), "master");
  assert.equal(degreeLevel("M.Sc."), "master");
  assert.equal(degreeLevel("Ph.D."), "doctor");
  assert.equal(degreeLevel("Associate of Arts"), "associate");
});

test("entry and skills controls belong to the Workday section filler, not the single-field matchers", () => {
  const document = page();
  const { adapter } = selectJobSiteAdapter("https://acme.wd1.myworkdayjobs.com/apply");
  const detected = adapter.detectFields({ root: document, availableKeys: ["candidate.currentLocation", "employment.0.company", "employment.0.jobTitle"], applicationAnswers: [], guideEntries: [] });
  assert.deepEqual(detected.fields.map((field) => field.key), []);
  assert.deepEqual(detected.unresolved.map((item) => item.question), [], "School, dates and skills are not reported as unanswered");
  assert.ok(detected.sections.some((item) => item.kind === "skills"));
});

test("rows: existing Workday entries are still filled; skills come from the Resume's skills text", () => {
  const context = { employment: [{ company: "Initech", jobTitle: "Senior Software Engineer", startDate: { year: 2021, month: 3 }, isCurrent: true }], skills: "Languages: Java, Python; Spring Boot • AWS | java" };
  const rows = repeatableSectionRows(context, [{ kind: "employment", existing: 1, addable: true, fillExisting: true }, { kind: "skills", existing: 0, addable: true }]);
  assert.equal(rows.employment[0].startDate, "2021-03");
  assert.deepEqual(rows.skills, ["Java", "Python", "Spring Boot", "AWS"]);
  assert.deepEqual(repeatableSectionRows(context, [{ kind: "employment", existing: 1, addable: true }]), {}, "Workable keeps skipping sections that already have entries");
  assert.deepEqual(sanitizeSectionRows({ skills: ["Java", 7, " ", "x".repeat(90)] }).skills, ["Java", "x".repeat(60)]);
  assert.deepEqual(splitSkills("CI/CD, C++, C#, Cloud:"), ["CI/CD", "C++", "C#"]);
});

test("the panel lists the skills result, and telemetry leaves out keys the API does not accept", () => {
  const rows = { skills: ["Java", "AWS"] };
  const fields = sectionResultFields([{ fieldId: "section_skills_0", key: "skills.0.entry", status: "VERIFIED" }], rows);
  assert.equal(fields[0].label, "Skills (2 from the Resume)");
  const telemetry = buildAutofillTelemetry({ resumeUpdatedAt: "2026-10-08T00:00:00Z", adapter: { id: "workday", version: "1.0.0" }, targetDomain: "acme.wd1.myworkdayjobs.com",
    fields: [...fields, { fieldId: "f1", key: "candidate.firstName", confidence: 90 }], selectedFieldIds: ["section_skills_0", "f1"], results: [{ fieldId: "section_skills_0", status: "VERIFIED" }, { fieldId: "f1", status: "VERIFIED" }] });
  assert.deepEqual(telemetry.fields.map((field) => field.fieldKey), ["candidate.firstName"]);
});
