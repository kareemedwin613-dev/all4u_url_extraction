import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectPersonalFields, fillPersonalFields, scorePersonalField } from "../extension/autofill/personal-field-adapter.js";

function field({ tag = "INPUT", type = "text", name = "", id = "", label = "", autocomplete = "", attributes: extraAttributes = {}, options = [], ownerDocument } = {}) {
  const attributes = new Map([["autocomplete", autocomplete]]), events = [];
  for (const [key,value] of Object.entries(extraAttributes)) attributes.set(key,value);
  return {
    tagName: tag, type, name, id, value: "", disabled: false, readOnly: false, required: false, options, ownerDocument,
    labels: label ? [{ textContent: label }] : [],
    closest: () => null,
    getAttribute: (key) => attributes.get(key) || "",
    setAttribute: (key, value) => attributes.set(key, value),
    dispatchEvent: (event) => { events.push(event.type); return true; },
    events,
  };
}
function root(elements) { return { querySelectorAll: () => elements }; }

test("v0.8.9 detects supported personal fields and assigns confidence/readiness", () => {
  const first = field({ label: "First name", autocomplete: "given-name" });
  const email = field({ type: "email", label: "Email address" });
  const password = field({ type: "password", label: "Password" });
  const fields = detectPersonalFields(root([password, email, first]), ["candidate.firstName", "candidate.email"]);
  assert.deepEqual(fields.map(({ key }) => key).sort(), ["candidate.email", "candidate.firstName"]);
  assert.ok(fields.every(({ confidence, readiness }) => confidence >= 90 && readiness === "READY"));
  assert.equal(scorePersonalField(password, { key: "candidate.email", autocomplete: [], pattern: /email/i }), -1);
});

test("v0.8.9 recognizes common ATS first and last name identifiers without visible labels", () => {
  const first = field({ name: "job_application[first_name]" });
  const last = field({ id: "candidateLastName" });
  const shortFirst = field({ name: "fname" });
  const fields = detectPersonalFields(root([first, last, shortFirst]), ["candidate.firstName", "candidate.lastName"]);
  assert.deepEqual(fields.map(({ key }) => key).sort(), ["candidate.firstName", "candidate.lastName"]);
  assert.ok(fields.every(({ readiness }) => readiness === "READY"));
});

test("v0.8.9 reads accessible labels referenced with aria-labelledby", () => {
  const ownerDocument = { getElementById: (id) => id === "given-label" ? { textContent: "Given name" } : null };
  const first = field({ attributes: { "aria-labelledby": "given-label" }, ownerDocument });
  assert.equal(detectPersonalFields(root([first]), ["candidate.firstName"])[0].key, "candidate.firstName");
});

test("v0.8.9 detects Workable-style sibling labels and the Resume summary textarea", () => {
  const first = field({});
  first.parentElement = { querySelector: (selector) => selector === "label" ? { textContent: "First name" } : null };
  const last = field({});
  last.previousElementSibling = { textContent: "Last name" };
  const summary = field({ tag: "TEXTAREA" });
  summary.parentElement = { querySelector: (selector) => selector === "label" ? { textContent: "Summary (Optional)" } : null };
  const fields = detectPersonalFields(root([first,last,summary]), ["candidate.firstName","candidate.lastName","candidate.summary"]);
  assert.deepEqual(fields.map(({key})=>key).sort(),["candidate.firstName","candidate.lastName","candidate.summary"]);
});

test("v0.8.9 fills selected fields, dispatches events, and verifies each result", () => {
  const first = field({ label: "First name", autocomplete: "given-name" });
  const [detected] = detectPersonalFields(root([first]), ["candidate.firstName"]);
  const [result] = fillPersonalFields([{ fieldId: detected.fieldId, key: detected.key, value: "Jordan" }], root([first]));
  assert.equal(result.status, "VERIFIED");
  assert.equal(first.value, "Jordan");
  assert.deepEqual(first.events, ["input", "change", "blur"]);
});

test("v0.8.9 verifies a phone when the ATS stores its country code separately", () => {
  const phone = field({ type: "tel", label: "Phone" });
  let nationalValue="";
  Object.defineProperty(phone,"value",{configurable:true,get:()=>nationalValue,set:(value)=>{nationalValue=String(value).replace(/^\+1\s*/,"");}});
  const [detected] = detectPersonalFields(root([phone]), ["candidate.phone"]);
  const [result] = fillPersonalFields([{ fieldId: detected.fieldId, key: detected.key, value: "+1 (469) 443-6431" }], root([phone]));
  assert.equal(result.status,"VERIFIED");
  assert.equal(phone.value,"(469) 443-6431");
});

test("v0.8.9 reports unsupported select values and detached fields without submitting", async () => {
  const country = field({ tag: "SELECT", label: "Country", autocomplete: "country-name", options: [{ value: "US", textContent: "United States" }] });
  const [detected] = detectPersonalFields(root([country]), ["candidate.country"]);
  assert.equal(fillPersonalFields([{ fieldId: detected.fieldId, key: detected.key, value: "Canada" }], root([country]))[0].code, "SELECT_OPTION_NOT_FOUND");
  assert.equal(fillPersonalFields([{ fieldId: detected.fieldId, key: detected.key, value: "United States" }], root([]))[0].code, "FIELD_NO_LONGER_AVAILABLE");
  const sources = await Promise.all(["../extension/autofill/personal-field-adapter.js", "../extension/content/personal-autofill.js", "../extension/background/service-worker.js", "../extension/sidepanel/components/AutofillPreview.jsx"].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /requestSubmit\(|\.submit\(|submitButton\.click\(/i);
});
