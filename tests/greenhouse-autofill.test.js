import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { GenericHtmlAdapter } from "../extension/adapters/generic-html-adapter.js";
import { autofillValue } from "../extension/autofill/autofill-context.js";
import { evidenceAnswer, questionTerms } from "../extension/autofill/resume-evidence.js";

const SPONSOR = "00000000-0000-4000-8000-000000000001";
const guide = [{ id: SPONSOR, question: "Will you now or in the future require sponsorship for employment visa status?", mode: "FIXED", value: "No", patterns: ["visa sponsorship", "require sponsorship"] }];

// Greenhouse job-boards: react-select inputs (role=combobox) open on mousedown and render
// #react-select-<id>-listbox; each has a hidden aria-hidden "required" input; the phone widget keeps a
// hidden country list of role=option items elsewhere; the Country picker displays only "+1" once chosen.
function greenhousePage() {
  const select = (id, label, options) => `<div class="field"><label id="${id}-label" for="${id}">${label}</label>
    <div class="select__container"><div class="select__control"><div class="select__value-container"><div class="select__placeholder">Select...</div>
    <div data-value=""><input class="select__input" id="${id}" role="combobox" aria-labelledby="${id}-label" type="text" aria-expanded="false" data-options="${options.join("|")}"></div></div></div>
    <input required tabindex="-1" aria-hidden="true" class="requiredInput" value=""></div></div>`;
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <div class="field"><label for="first_name">First Name*</label><input id="first_name" type="text"></div>
    <div class="field"><label for="email">Email*</label><input id="email" type="text"></div>
    ${select("country", "Country*", ["United States +1", "Canada +1", "Afghanistan +93"])}
    <div class="field"><label for="phone">Phone*</label><input id="phone" type="tel"></div>
    <div class="field"><label for="question_1">LinkedIn Profile*</label><input id="question_1" type="text"></div>
    ${select("question_2", "Will you now or in the future require visa sponsorship?*", ["Yes", "No"])}
    ${select("question_3", "Do you have 9+ years of professional software development experience?*", ["Yes", "No"])}
    ${select("question_4", "Do you have experience with front end technologies such as Angular and React?*", ["Yes", "No"])}
    ${select("question_5", "Do you have experience with Rust and Elixir?*", ["Yes", "No"])}
    </form><ul class="iti__country-list" aria-hidden="true"><li role="option">Norway +47</li><li role="option">United States +1</li></ul></body></html>`);
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  for (const input of document.querySelectorAll("input[role=combobox]")) {
    const control = input.closest(".select__control"), display = control.querySelector(".select__placeholder");
    control.addEventListener("mousedown", () => {
      document.getElementById(`react-select-${input.id}-listbox`)?.remove();
      const list = document.createElement("div");
      list.id = `react-select-${input.id}-listbox`; list.setAttribute("role", "listbox");
      for (const text of input.getAttribute("data-options").split("|")) {
        const option = document.createElement("div"); option.setAttribute("role", "option"); option.textContent = text;
        option.addEventListener("click", () => { display.className = "select__single-value"; display.textContent = input.id === "country" ? text.replace(/^.* (\+\d+)$/, "$1") : text; list.remove(); });
        list.append(option);
      }
      input.setAttribute("aria-controls", list.id);
      control.parentElement.append(list);
    });
  }
  return document;
}

const context = {
  values: { "candidate.firstName": "Jane", "candidate.email": "jane@example.com", "candidate.phone": "+1 305 555 0100", "candidate.country": "United States" },
  skills: "Java, Spring Boot, React, AWS",
  employment: [{ jobTitle: "Senior Engineer", experienceDetails: "Built React front ends and Java services.", startDate: { year: 2014, month: 1 }, isCurrent: true }],
  guideEntries: guide, applicationAnswers: [],
};

test("Greenhouse: react-select dropdowns, country, and experience questions are answered; helpers are untouched", async () => {
  const document = greenhousePage(), adapter = new GenericHtmlAdapter();
  const { fields, unresolved } = adapter.detectFields({ root: document, availableKeys: Object.keys(context.values), applicationAnswers: [], guideEntries: guide });
  const results = await adapter.fillFields({ root: document, fields: fields.map((field) => ({ ...field, value: autofillValue(context, field) })) });
  const shown = (id) => document.getElementById(id).closest(".select__control").querySelector(".select__single-value")?.textContent;
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
  assert.equal(shown("country"), "+1", "the phone-country picker shows only the dial code");
  assert.deepEqual(["question_2", "question_3", "question_4", "question_5"].map(shown), ["No", "Yes", "Yes", "No"]);
  assert.ok([...document.querySelectorAll("input[aria-hidden=true]")].every((input) => !input.value && ![...input.attributes].some((a) => a.name.startsWith("data-resume-jd"))));
  const missing = unresolved.find((item) => item.reason === "RESUME_VALUE_MISSING");
  assert.equal(missing?.missingKey, "candidate.linkedInUrl", "a LinkedIn field with no Resume value is reported, not left silent");
  assert.ok(!unresolved.some((item) => /iti|Norway/i.test(item.question)));
});

test("experience rules: totals, listed skills, examples, and unknown years", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  const resume = { skills: "Java, React, Kubernetes, Jenkins", employment: [{ jobTitle: "Engineer", experienceDetails: "Java APIs and Datadog monitoring", startDate: { year: 2019, month: 1 }, isCurrent: true }] };
  assert.equal(evidenceAnswer(resume, "Do you have 9+ years of professional software development experience?", now), "No");
  assert.equal(evidenceAnswer(resume, "Do you have 5+ years of experience?", now), "Yes");
  assert.equal(evidenceAnswer(resume, "Do you have 5+ years of experience with Java?", now), "Yes");
  assert.equal(evidenceAnswer(resume, "Do you have 3+ years of experience with Kubernetes?", now), "", "listed but no role shows the years: a person answers");
  assert.equal(evidenceAnswer(resume, "Do you have 2+ years of experience with Go?", now), "No", "not on the Resume");
  assert.equal(evidenceAnswer(resume, "Do you have experience with CI/CD and observability?", now), "Yes", "Jenkins and Datadog are evidence");
  assert.equal(evidenceAnswer(resume, "Do you have experience with front end technologies such as Angular and Vue?", now), "No", "React does not count for Angular or Vue");
  assert.deepEqual(questionTerms("Do you have hands-on experience designing and delivering large-scale, distributed systems in production?").terms, ["large-scale", "distributed systems"]);
});

test("v3.159 reads contact details from the original Resume and accepts evidence keys", async () => {
  const [sql, dto, worker] = await Promise.all([
    readFile(new URL("../supabase/migrations/202610070900_v3_159_autofill_parent_contact_and_evidence.sql", import.meta.url), "utf8"),
    readFile(new URL("../apps/api/src/applications/application.dto.ts", import.meta.url), "utf8"),
    readFile(new URL("../extension/background/service-worker.js", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /'candidate\.linkedInUrl',p\.linkedin_url/);
  assert.doesNotMatch(sql, /r\.(candidate_|address_|linkedin_url|github_url|portfolio_url)/);
  assert.match(sql, /'skills',case when coalesce\(\(p\.autofill_preferences->>'allowProfileFields'\)::boolean,false\)/);
  assert.match(sql, /\|guide\|evidence\)\\\./);
  assert.match(sql, /if position\('\|guide\|evidence\)\\\.' in v_def\)>0 then return; end if;/, "safe to re-run");
  assert.match(dto, /guide\|evidence\)\\\./);
  assert.match(worker, /\^evidence\\\.\\d\{1,3\}\$/);
});
