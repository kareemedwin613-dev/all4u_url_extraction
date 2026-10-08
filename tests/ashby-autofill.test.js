import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { GenericHtmlAdapter } from "../extension/adapters/generic-html-adapter.js";
import { containerQuestion } from "../extension/autofill/form-context.js";
import { findBestOption } from "../extension/autofill/option-matching.js";

const guide = [
  { id: "00000000-0000-4000-8000-000000000001", question: "Are you legally authorized to work in the United States?", mode: "FIXED", patterns: ["authorized to work"] },
  { id: "00000000-0000-4000-8000-000000000002", question: "How did you hear about us?", mode: "FIXED", patterns: ["how did you hear"] },
  { id: "00000000-0000-4000-8000-000000000003", question: "What does Location mean in Personal Details?", mode: "DERIVED", source: "candidate.currentLocation", patterns: ["location", "location do you intend to work from"] },
];
const values = { "candidate.fullName": "Jane Doe", "candidate.firstName": "Jane", "candidate.lastName": "Doe" };
const guideValues = { "00000000-0000-4000-8000-000000000001": "Yes", "00000000-0000-4000-8000-000000000002": "LinkedIn", "00000000-0000-4000-8000-000000000003": "Miami, FL, USA" };

// Ashby markup: each question is a div[data-field-path] whose <label for> often points at an id the
// control does not have; radio questions are a fieldset whose first <label> is the question.
function ashbyPage() {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <div data-field-path="name"><label for="name">Preferred First &amp; Last Name</label><div><input id="name" name="name" type="text"></div></div>
    <div data-field-path="first"><label for="first">Legal First Name</label><div><input id="first" name="first" type="text"></div></div>
    <div data-field-path="last"><label for="last">Legal Last Name</label><div><input id="last" name="last" type="text"></div></div>
    <div data-field-path="_systemfield_location"><label for="_systemfield_location">What location do you intend to work from?</label><div><input id="loc" placeholder="Start typing..." role="combobox"><button type="button">v</button></div></div>
    <div data-field-path="heard"><fieldset><label for="heard">How did you hear about Temporal?</label><div><input id="heard" placeholder="Start typing..." role="combobox"></div></fieldset></div>
    <div data-field-path="auth"><fieldset><label for="auth">Are you legally authorized to work in this location?</label>
      <div><input type="radio" id="a0" name="auth"><label for="a0">Yes, but I will require sponsorship now or in the future to maintain work authorization</label></div>
      <div><input type="radio" id="a1" name="auth"><label for="a1">Yes, and I will not require sponsorship now or in the future</label></div>
      <div><input type="radio" id="a2" name="auth"><label for="a2">No, I am not currently authorized to work in this location</label></div></fieldset></div>
    <div id="listbox"></div></form></body></html>`);
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  const listbox = document.getElementById("listbox");
  const show = (combo, items) => { listbox.innerHTML = items.map((item) => `<div role="option">${item}</div>`).join(""); for (const option of listbox.children) option.addEventListener("click", () => { combo.value = option.textContent; listbox.innerHTML = ""; }); };
  // Location suggestions arrive after typing, like a network search.
  const loc = document.getElementById("loc");
  loc.addEventListener("input", () => setTimeout(() => show(loc, loc.value.startsWith("Miami") ? ["Miami, Florida, United States", "Miami, Oklahoma, United States"] : []), 150));
  const heard = document.getElementById("heard");
  heard.addEventListener("click", () => show(heard, ["Company Website or Blog", "Job Board (Indeed, LinkedIn Jobs, etc.)", "Social Media (LinkedIn, X, Instragram, etc.)"]));
  return document;
}

test("Ashby: unlinked labels and fieldset questions are read from the field's container", () => {
  const document = ashbyPage();
  assert.equal(containerQuestion(document.getElementById("loc")), "What location do you intend to work from?");
  const radios = [...document.querySelectorAll('input[name="auth"]')];
  assert.equal(containerQuestion(radios[0], radios), "Are you legally authorized to work in this location?");
  assert.equal(containerQuestion(document.getElementById("name")), "", "a linked label is read through the control's own labels");
});

test("Ashby: names, location search, referral source, and work authorization are filled", async () => {
  const document = ashbyPage(), adapter = new GenericHtmlAdapter();
  const { fields } = adapter.detectFields({ root: document, availableKeys: Object.keys(values), applicationAnswers: [], guideEntries: guide });
  const requests = fields.map((field) => ({ ...field, value: values[field.key] ?? guideValues[field.guideEntryId] }));
  const results = await adapter.fillFields({ root: document, fields: requests });
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
  assert.deepEqual([document.getElementById("name").value, document.getElementById("first").value, document.getElementById("last").value], ["Jane Doe", "Jane", "Doe"]);
  assert.equal(document.getElementById("loc").value, "Miami, Florida, United States");
  assert.equal(document.getElementById("heard").value, "Job Board (Indeed, LinkedIn Jobs, etc.)");
  assert.deepEqual([...document.querySelectorAll('input[name="auth"]')].map((radio) => Boolean(radio.checked)), [false, true, false]);
});

test("Ashby: Yes picks the option without sponsorship; ordinary Yes/No questions are unaffected", () => {
  const pick = (texts, wanted) => findBestOption(texts.map((text) => ({ text })), wanted, (item) => [item.text])?.text;
  assert.equal(pick(["Yes, but I will require sponsorship", "Yes, and I will not require sponsorship"], "Yes"), "Yes, and I will not require sponsorship");
  assert.equal(pick(["Yes", "No"], "Yes"), "Yes");
  assert.equal(pick(["Yes, I will require visa sponsorship", "No, I will not require sponsorship"], "No"), "No, I will not require sponsorship");
});

test("content scripts are isolated bundles so the Resume and Autofill scripts cannot overwrite each other", async () => {
  const [build, migration] = await Promise.all([
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202610062200_v3_158_guide_location_wordings.sql", import.meta.url), "utf8"),
  ]);
  assert.match(build, /format:"iife",entryPoints:\{"content\/dashboard-bridge"[^}]*"content\/resume-upload"[^}]*"content\/personal-autofill"/);
  assert.match(migration, /'location do you intend to work from'/);
  assert.match(migration, /cardinality\(autofill_patterns\) <= 16/, "the 20-wording limit is respected");
});
