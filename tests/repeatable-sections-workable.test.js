import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { WORKABLE_SECTIONS, detectRepeatableSections, fillRepeatableSections, safeToClick, sanitizeSectionRows } from "../extension/autofill/repeatable-sections.js";
import { repeatableSectionRows, sectionResultFields } from "../extension/autofill/autofill-context.js";

// A Workable-like Experience section: "+ Add" opens an inline editor; Save turns it into an entry that
// appears first in the list. `rejectSave` keeps the editor open like a site-side validation error.
function workablePage({ addType = "button", existing = 0, rejectSave = false } = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <div data-ui="experience"><div><p>Experience</p><button data-ui="add-section" aria-label="Add Experience" type="${addType}">+ Add</button></div><ul></ul></div>
    <button data-ui="apply-button" type="submit">Submit application</button></form></body></html>`);
  Object.assign(globalThis, { Event: window.Event, MouseEvent: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  const section = document.querySelector('[data-ui="experience"]'), list = section.querySelector("ul"), add = section.querySelector("button");
  const entry = (title) => { const li = document.createElement("li"); li.innerHTML = `<div data-ui="group"><dd data-ui="title">${title}</dd></div>`; list.prepend(li); };
  for (let index = 0; index < existing; index += 1) entry(`Existing ${index}`);
  let submitted = 0;
  document.querySelector('[data-ui="apply-button"]').addEventListener("click", () => { submitted += 1; });
  add.addEventListener("click", () => {
    add.disabled = true;
    const editor = document.createElement("div");
    editor.innerHTML = `<input name="title"><input name="company"><textarea name="summary"></textarea><input name="start_date"><input name="end_date"><input type="checkbox" name="current">
      <button type="button" data-ui="save-section">Update</button><button type="button" data-ui="cancel-section">Cancel</button>`;
    section.append(editor);
    editor.querySelector('[data-ui="save-section"]').addEventListener("click", () => {
      if (rejectSave) return;
      entry(`${editor.querySelector('[name="title"]').value} ${editor.querySelector('[name="company"]').value}`);
      editor.remove();
      add.disabled = false;
    });
    editor.querySelector('[data-ui="cancel-section"]').addEventListener("click", () => { editor.remove(); add.disabled = false; });
  });
  return { document, titles: () => [...list.querySelectorAll('[data-ui="group"]')].map((item) => item.textContent.trim()), submitted: () => submitted };
}

const ROWS = [
  { company: "Acme", jobTitle: "Senior Engineer", description: "Built the payments API.", startDate: "2022-01", isCurrent: true },
  { company: "Globex", jobTitle: "Engineer", description: "Billing.", startDate: "2019-06", endDate: "2021-12", isCurrent: false },
];
const EMPLOYMENT_ONLY = { employment: WORKABLE_SECTIONS.employment };

test("Workable sections: every Resume job is added and the page keeps Resume order", async () => {
  const page = workablePage();
  assert.deepEqual(detectRepeatableSections(page.document, EMPLOYMENT_ONLY), [{ kind: "employment", existing: 0, addable: true }]);
  const results = await fillRepeatableSections(page.document, { employment: ROWS }, EMPLOYMENT_ONLY);
  assert.deepEqual(results.map((result) => [result.key, result.status]), [["employment.1.entry", "VERIFIED"], ["employment.0.entry", "VERIFIED"]]);
  assert.deepEqual(page.titles(), ["Senior Engineer Acme", "Engineer Globex"]);
  assert.equal(page.submitted(), 0);
});

test("Workable sections: existing entries are kept and nothing is duplicated", async () => {
  const page = workablePage({ existing: 1 });
  const results = await fillRepeatableSections(page.document, { employment: ROWS }, EMPLOYMENT_ONLY);
  assert.deepEqual(results, [{ fieldId: "section_employment_0", key: "employment.0.entry", status: "SKIPPED", code: "SECTION_ALREADY_HAS_ENTRIES" }]);
  assert.deepEqual(page.titles(), ["Existing 0"]);
  assert.deepEqual(repeatableSectionRows({ employment: [{ company: "Acme", jobTitle: "Engineer", startDate: { year: 2022, month: 1 } }] }, [{ kind: "employment", existing: 1, addable: true }]), {});
});

test("Workable sections: a submit-type button is never clicked", async () => {
  const page = workablePage({ addType: "submit" });
  assert.equal(detectRepeatableSections(page.document, EMPLOYMENT_ONLY)[0].addable, false);
  const results = await fillRepeatableSections(page.document, { employment: ROWS }, EMPLOYMENT_ONLY);
  assert.equal(results[0].code, "SECTION_ADD_UNAVAILABLE");
  assert.equal(page.titles().length, 0);
  assert.equal(page.submitted(), 0);
  assert.equal(safeToClick({ tagName: "BUTTON", getAttribute: () => null }), false, "a button without a type submits its form");
});

test("Workable sections: a rejected entry stays open for the reviewer and stops further adds", async () => {
  const page = workablePage({ rejectSave: true });
  const results = await fillRepeatableSections(page.document, { employment: ROWS }, EMPLOYMENT_ONLY);
  assert.deepEqual(results.map((result) => result.code), ["SECTION_SAVE_REJECTED"]);
  assert.equal(page.document.querySelectorAll('[data-ui="save-section"]').length, 1);
});

test("Workable sections: rows are bounded and shown as readable results", () => {
  const rows = repeatableSectionRows({ employment: [{ company: "Acme", jobTitle: "Engineer", startDate: { year: 2022, month: 1 }, isCurrent: true, experienceDetails: "x".repeat(20000) }], education: [{ institution: "State University", startDate: { year: 2011 } }] }, [{ kind: "employment", existing: 0, addable: true }, { kind: "education", existing: 0, addable: true }]);
  assert.deepEqual(rows.employment[0].startDate, "2022-01");
  assert.equal(rows.employment[0].endDate, "");
  assert.equal(rows.education[0].startDate, "2011");
  const clean = sanitizeSectionRows({ ...rows, employment: [...rows.employment, { jobTitle: "<script>", startDate: "June 2020", isCurrent: "yes" }] });
  assert.equal(clean.employment[0].description.length, 10000);
  assert.deepEqual([clean.employment[1].startDate, clean.employment[1].isCurrent], [undefined, false]);
  assert.deepEqual(sectionResultFields([{ fieldId: "section_employment_0", key: "employment.0.entry", status: "VERIFIED" }, { fieldId: "x", key: "candidate.email" }], rows).map((field) => field.label), ["Experience 1: Engineer at Acme"]);
});

test("Workable adapter and side panel wire sections through without clicking the application's submit button", async () => {
  const [adapter, app, worker, sections] = await Promise.all(["../extension/adapters/platforms/workable.adapter.js", "../extension/sidepanel/App.jsx", "../extension/background/service-worker.js", "../extension/autofill/repeatable-sections.js"].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(adapter, /fillRepeatableSections\(context\.root\|\|document,context\.sections,WORKABLE_SECTIONS\)/);
  assert.match(app, /sections: ?sectionRows/);
  assert.match(app, /field\.controlType!=="section"/, "retries never re-add entries");
  assert.match(worker, /sanitizeSectionRows\(payload\?\.sections\)/);
  assert.doesNotMatch(sections, /apply-button|requestSubmit\(|\.submit\(/);
});

test("Workable questions: aria-hidden Yes/No radios named by their group, and the cover letter text box", async () => {
  const { GenericHtmlAdapter } = await import("../extension/adapters/generic-html-adapter.js");
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <label for="cover_letter">Cover letter (Optional)</label><textarea id="cover_letter" name="cover_letter"></textarea>
    <span id="q1_label"><strong>Are you authorized to work in the United States without the need for present or future sponsorship?</strong></span>
    <fieldset role="radiogroup" aria-labelledby="q1_label">
      <div role="radio"><label><input id="q1y" type="radio" name="QA_1" value="true" aria-hidden="true" tabindex="-1"><span>YES</span></label></div>
      <div role="radio"><label><input id="q1n" type="radio" name="QA_1" value="false" aria-hidden="true" tabindex="-1"><span>NO</span></label></div>
    </fieldset></form></body></html>`);
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  const guide = [{ id: "00000000-0000-4000-8000-000000000002", question: "Are you legally authorized to work in the United States?", mode: "FIXED", patterns: ["authorized to work"] }];
  const adapter = new GenericHtmlAdapter();
  const { fields } = adapter.detectFields({ root: document, availableKeys: ["candidate.coverLetter"], applicationAnswers: [], guideEntries: guide });
  assert.deepEqual(fields.map((field) => field.key).sort(), ["candidate.coverLetter", "guide.00000000-0000-4000-8000-000000000002"]);
  const letter = "Dear Hiring Manager,\n\nI am excited to apply.\n\nJane Doe";
  const results = await adapter.fillFields({ root: document, fields: fields.map((field) => ({ ...field, value: field.key === "candidate.coverLetter" ? letter : "Yes" })) });
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
  assert.equal(document.getElementById("cover_letter").value, letter, "line breaks are kept");
  assert.equal(Boolean(document.getElementById("q1y").checked), true);
  const empty = adapter.detectFields({ root: parseHTML(`<form><label for="c">Cover letter</label><textarea id="c"></textarea></form>`).document, availableKeys: [], applicationAnswers: [], guideEntries: [] });
  assert.ok(!empty.unresolved.some((item) => item.reason === "RESUME_VALUE_MISSING"), "a missing cover letter is not reported as missing from the Resume");
});
