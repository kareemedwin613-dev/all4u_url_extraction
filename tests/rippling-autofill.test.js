import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { GenericHtmlAdapter } from "../extension/adapters/generic-html-adapter.js";
import { contactQuestion, personalFieldCandidates, placeholderOnly } from "../extension/autofill/personal-field-adapter.js";

// Rippling (ats.rippling.com): inputs have ids like "field-8" and random names, autocomplete is off, and the
// visible label is only reachable through aria-labelledby. Dropdown searches carry a "Search" placeholder.
function ripplingPage() {
  const field = (n, testId, label, extra = "") => `<div class="css-fuqajr"><div class="css-1fttcpj"><span id="field-${n}-label">${label}</span>
    <div class="css-1mlcsw"><input type="text" id="field-${n}" name="Rnd${n}x_q" autocomplete="off" aria-labelledby="field-${n}-label" placeholder="${label}" data-testid="${testId}" ${extra}></div></div></div>`;
  const { document, window } = parseHTML(`<!doctype html><html><body><form><div class="css-fc738i"><h2>Application: Team Lead, Software Development</h2>
    ${field(8, "input-first_name", "First name")}${field(12, "input-last_name", "Last name")}${field(16, "input-email", "Email")}
    ${field(27, "input-current_company", "Current company")}
    <input type="text" id="field-34" role="combobox" aria-label="Search" placeholder="Search" data-testid="input-select-search-input">
    ${field(31, "input-phone_number", "Phone number")}
    </div></form></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement });
  return document;
}

test("Rippling contact fields are claimed by the contact rules, not mistaken for a school entry's 'field of study'", () => {
  const document = ripplingPage();
  const keys = ["candidate.firstName", "candidate.lastName", "candidate.email", "candidate.phone", "candidate.currentCompany"];
  const claimed = Object.fromEntries(personalFieldCandidates(document, keys).map((candidate) => [candidate.element.getAttribute("data-testid"), candidate.key]));
  assert.equal(claimed["input-first_name"], "candidate.firstName");
  assert.equal(claimed["input-last_name"], "candidate.lastName");
  assert.equal(claimed["input-email"], "candidate.email");
  assert.equal(claimed["input-phone_number"], "candidate.phone");
  const { fields } = new GenericHtmlAdapter().detectFields({ root: document, availableKeys: keys, applicationAnswers: [], guideEntries: [] });
  assert.ok(!fields.some((field) => /^education\./.test(field.key)), JSON.stringify(fields.map((field) => field.key)));
});

test("'Field of study' still means a school entry; a bare 'field' id does not", () => {
  const { document, window } = parseHTML(`<!doctype html><html><body><form><fieldset><legend>Education</legend>
    <label for="study">Field of Study</label><input type="text" id="study" name="education[0][field]"></fieldset></form></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  const keys = ["education.0.fieldOfStudy"];
  assert.deepEqual(personalFieldCandidates(document, keys).map((candidate) => candidate.key), ["education.0.fieldOfStudy"]);
});

test("placeholders and plain contact labels are never sent to AI recognition", () => {
  for (const label of ["Select", "Search", "Select...", "Please select", "Choose"]) assert.equal(placeholderOnly(label), true, label);
  for (const label of ["First name", "Last name", "Email", "Phone number", "Current company"]) assert.equal(contactQuestion(label), true, label);
  for (const label of ["Location", "Pronouns", "Why do you want to work here?", "Will you require sponsorship?", "Field of Study"]) {
    assert.equal(placeholderOnly(label) || contactQuestion(label), false, label);
  }
  const app = readFileSync(new URL("../extension/sidepanel/App.jsx", import.meta.url), "utf8");
  assert.match(app, /item\.reason === "NO_MATCHING_ANSWER" && !placeholderOnly\(item\.question\) && !contactQuestion\(item\.question\)/);
});
