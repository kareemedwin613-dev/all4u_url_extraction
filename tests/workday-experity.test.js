import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { personalFieldCandidates } from "../extension/autofill/personal-field-adapter.js";
import { detectUnresolvedQuestions } from "../extension/autofill/screening-field-adapter.js";
import { workdayResumeInputs } from "../extension/adapters/platforms/workday.adapter.js";

function page(body) {
  const { document, window } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}
const field = (id, label, extra = "") => `<div data-automation-id="formField-${id}"><label for="${id}">${label}<abbr>*</abbr></label><input id="${id}" type="text" ${extra}></div>`;

// Workday My Information: Country Phone Code (a search box), Phone Number and Phone Extension, all mentioning "phone".
test("Workday: the phone number goes into Phone Number, not Country Phone Code or Phone Extension", () => {
  const document = page(`<div data-automation-id="phone-section">
    <div data-automation-id="formField-phoneType"><label>Phone Device Type<abbr>*</abbr></label><button type="button" aria-haspopup="listbox">Select One</button></div>
    ${field("phoneNumber--countryPhoneCode", "Country Phone Code", 'required data-automation-id="searchBox"')}
    ${field("phoneNumber--phoneNumber", "Phone Number", "required")}
    ${field("phoneNumber--extension", "Phone Extension")}</div>`);
  assert.deepEqual(personalFieldCandidates(document, ["candidate.phone"]).map((item) => item.element.id), ["phoneNumber--phoneNumber"]);
});

test("a phone label that mentions the country code is still the phone number", () => {
  assert.deepEqual(personalFieldCandidates(page(field("p", "Phone number (include country code)")), ["candidate.phone"]).map((item) => item.key), ["candidate.phone"]);
});

// Workday "Autofill with Resume": the step heading can be far from the drop zone.
test("Workday: the only upload on the page is the Resume, even when no heading nearby names it", () => {
  const nested = (depth, inner) => depth ? `<div>${nested(depth - 1, inner)}</div>` : inner;
  const document = page(`<div data-automation-id="applyFlowPage"><h2>Autofill with Resume</h2>${nested(8, `<div data-automation-id="file-upload-drop-zone"><p>Drop file here</p><button type="button" data-automation-id="select-files">Select file</button><input type="file" data-automation-id="file-upload-input-ref"></div>`)}</div>`);
  const [found] = workdayResumeInputs(document);
  assert.equal(found.input.getAttribute("data-automation-id"), "file-upload-input-ref");
  assert.equal(found.score, 80);
});

test("Workday: with two uploads, an unnamed one is never guessed to be the Resume", () => {
  const upload = `<div><input type="file"></div>`;
  assert.deepEqual(workdayResumeInputs(page(`<section><h3>Supporting documents</h3>${upload}${upload}</section>`)), []);
});

test("Workday: race options on Voluntary Disclosures are left for the person, never matched", () => {
  const options = ["Asian (Not Hispanic or Latino) (United States of America)", "Hispanic or Latino (United States of America)", "Two or More Races (Not Hispanic or Latino) (United States of America)"];
  const document = page(options.map((label, index) => `<div><input type="checkbox" id="r${index}"><label for="r${index}">${label}</label></div>`).join(""));
  assert.deepEqual(detectUnresolvedQuestions(document).map((item) => item.reason), ["REVIEW_REQUIRED", "REVIEW_REQUIRED", "REVIEW_REQUIRED"]);
});

// Experity "My Experience" (from a structure snapshot): Workday's own resume parsing has already created the job and
// school entries, so Autofill fills the empty fields of the matching entries instead of adding new ones.
import { detectWorkdaySections, fillWorkdaySections, workdayEntries } from "../extension/autofill/workday.js";
import { sanitizeDetectedSections, sanitizeSectionRows } from "../extension/autofill/repeatable-sections.js";
import { repeatableSectionRows } from "../extension/autofill/autofill-context.js";

function myExperience() {
  const job = (n, title, company) => `<div role="group"><h4>Work Experience ${n - 15}</h4><button type="button">Delete</button>
    <div data-automation-id="formField-jobTitle"><label for="workExperience-${n}--jobTitle">Job Title*</label><input type="text" id="workExperience-${n}--jobTitle" name="jobTitle" value="${title}" required></div>
    <div data-automation-id="formField-companyName"><label for="workExperience-${n}--companyName">Company*</label><input type="text" id="workExperience-${n}--companyName" name="companyName" value="${company}" required></div>
    <div data-automation-id="formField-location"><label for="workExperience-${n}--location">Location</label><input type="text" id="workExperience-${n}--location" name="location"></div>
    <div data-automation-id="formField-startDate"><div data-automation-id="dateInputWrapper"><input role="spinbutton" data-automation-id="dateSectionMonth-input" id="workExperience-${n}--startDate-dateSectionMonth-input" aria-label="Month"><input role="spinbutton" data-automation-id="dateSectionYear-input" id="workExperience-${n}--startDate-dateSectionYear-input" aria-label="Year"></div></div>
    <div data-automation-id="formField-roleDescription"><label for="workExperience-${n}--roleDescription">Role Description</label><textarea id="workExperience-${n}--roleDescription"></textarea></div></div>`;
  const { document, window } = parseHTML(`<!doctype html><html><body><div data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="we"><h3 id="we">Work Experience</h3>${job(16, "Senior Software Engineer", "Initech")}${job(17, "Software Engineer", "Globex")}
      <button type="button" data-automation-id="add-button">Add Another</button></div>
    <div role="group" aria-labelledby="ed"><h3 id="ed">Education</h3><div role="group">
      <div data-automation-id="formField-schoolName"><label for="education-45--schoolName">School or University*</label><input type="text" id="education-45--schoolName" name="schoolName" value="State University" required></div>
      <div data-automation-id="formField-degree"><label for="education-45--degree">Degree*</label><button type="button" id="education-45--degree" name="degree" aria-haspopup="listbox">BS</button></div></div>
      <button type="button" data-automation-id="add-button">Add Another</button></div>
    <div data-automation-id="formField-skills"><label for="skills--skills">Type to Add Skills</label><input id="skills--skills" placeholder="Search"></div>
  </div></div></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, { Event: window.Event, KeyboardEvent: window.KeyboardEvent || window.Event, FocusEvent: window.FocusEvent || window.Event, InputEvent: window.InputEvent || window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  return document;
}

test("Experity My Experience: entries Workday already created reach the filler, and skills are kept", () => {
  const detected = detectWorkdaySections(myExperience());
  const passed = sanitizeDetectedSections(detected);
  assert.deepEqual(passed, [
    { kind: "employment", existing: 2, addable: true, fillExisting: true },
    { kind: "education", existing: 1, addable: true, fillExisting: true },
    { kind: "skills", existing: 0, addable: true, fillExisting: false },
  ], "the worker keeps fillExisting and the skills section");
  const context = { employment: [{ company: "Initech", jobTitle: "Senior Software Engineer", experienceDetails: "Built payments.", startDate: "2021-03" }],
    education: [{ institution: "State University", degree: "Bachelor of Science" }], skills: "Java, AWS" };
  const rows = repeatableSectionRows(context, passed);
  assert.deepEqual(Object.keys(rows).sort(), ["education", "employment", "skills"]);
});

test("Experity My Experience: every field Workday's parser filled is overwritten from the Resume", async () => {
  const document = myExperience();
  document.getElementById("workExperience-16--location").value = "Austn";
  document.getElementById("workExperience-16--roleDescription").value = "garbled text from the parser";
  const context = { employment: [{ company: "Initech", jobTitle: "Staff Software Engineer", location: "Austin, TX", experienceDetails: "Built payments.", startDate: "2021-03" }] };
  const rows = sanitizeSectionRows(repeatableSectionRows(context, sanitizeDetectedSections(detectWorkdaySections(document))));
  const results = await fillWorkdaySections(document, { employment: rows.employment });
  assert.deepEqual(results.map((item) => [item.key, item.status]), [["employment.0.entry", "VERIFIED"]]);
  assert.equal(document.getElementById("workExperience-16--jobTitle").value, "Staff Software Engineer", "the parser's title is replaced");
  assert.equal(document.getElementById("workExperience-16--location").value, "Austin, TX");
  assert.equal(document.getElementById("workExperience-16--roleDescription").value, "Built payments.");
  assert.equal(document.getElementById("workExperience-16--startDate-dateSectionMonth-input").value, "03");
  assert.equal(document.getElementById("workExperience-16--startDate-dateSectionYear-input").value, "2021");
  assert.equal(document.getElementById("workExperience-17--roleDescription").value, "", "a Workday entry beyond the Resume's rows is left alone");
  assert.equal(document.querySelectorAll("[id$='--jobTitle']").length, 2, "nothing is deleted or duplicated");
});

test("Experity My Experience: entries whose names the parser garbled are paired in Resume order", async () => {
  const { pairWorkdayEntries } = await import("../extension/autofill/workday.js");
  const document = myExperience();
  const entries = workdayEntries(document).employment;
  const rows = [{ company: "Umbrella Corp", jobTitle: "Lead Engineer" }, { company: "Globex", jobTitle: "Software Engineer" }];
  const { pairs } = pairWorkdayEntries("employment", entries, rows);
  assert.deepEqual(entries.map((entry) => pairs.get(entry)), [0, 1], "Globex matches row 1 by name; the garbled first entry takes row 0");
});
