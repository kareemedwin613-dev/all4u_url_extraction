import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { GenericHtmlAdapter } from "../extension/adapters/generic-html-adapter.js";
import { addRecognizedWordings, autofillValue, guideDefinitions, screeningDefinitions } from "../extension/autofill/autofill-context.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const AUTH = "00000000-0000-4000-8000-000000000011";
const context = {
  values: { "candidate.firstName": "Ana" },
  guideEntries: [{ id: AUTH, question: "Are you legally authorized to work in the US?", mode: "FIXED", value: "Yes", patterns: ["authorized to work"] }],
  applicationAnswers: [{ answerKey: "requires_sponsorship", answerType: "BOOLEAN", answerValue: false, questionPatterns: ["require sponsorship"] }],
};

function page() {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <div><label for="first">First name</label><input id="first" type="text"></div>
    <fieldset><legend>Can you lawfully take up employment in the United States without restrictions?</legend>
      <label><input type="radio" name="q1" value="yes">Yes</label><label><input type="radio" name="q1" value="no">No</label></fieldset>
    <div><label for="q2">Will your employment here ever depend on an employer-backed visa petition?</label>
      <select id="q2"><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
    <div><label for="q3">Why do you want to join us?</label><textarea id="q3"></textarea></div>
    </form></body></html>`);
  // linkedom lacks <select>.value and the <option> text fallback; mirror Chrome's behavior.
  Object.defineProperty(window.HTMLOptionElement.prototype, "value", { configurable: true, get() { return this.getAttribute("value") ?? this.textContent.trim(); } });
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() { const options = [...this.options]; return (options.find((option) => option.hasAttribute("selected")) || options[0])?.value ?? ""; },
    set(next) { for (const option of this.options) if (option.value === next) option.setAttribute("selected", ""); else option.removeAttribute("selected"); },
  });
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement });
  return document;
}

test("unanswered questions carry the employer's option labels for recognition", () => {
  const document = page(), adapter = new GenericHtmlAdapter();
  const { unresolved } = adapter.detectFields({ root: document, availableKeys: ["candidate.firstName"], applicationAnswers: screeningDefinitions(context), guideEntries: guideDefinitions(context) });
  const byQuestion = Object.fromEntries(unresolved.map((item) => [item.question, item]));
  assert.deepEqual(byQuestion["Can you lawfully take up employment in the United States without restrictions?"].options, ["Yes", "No"]);
  assert.deepEqual(byQuestion["Will your employment here ever depend on an employer-backed visa petition?"].options, ["Yes", "No"], "placeholder option dropped");
  assert.deepEqual(byQuestion["Why do you want to join us?"].options, []);
});

test("recognized questions become this page's wordings and the normal matchers fill them on a second scan", async () => {
  const document = page(), adapter = new GenericHtmlAdapter();
  const definitions = { applicationAnswers: screeningDefinitions(context), guideEntries: guideDefinitions(context) };
  const first = adapter.detectFields({ root: document, availableKeys: ["candidate.firstName"], ...definitions });
  assert.deepEqual(first.fields.map((field) => field.key), ["candidate.firstName"]);
  const asked = first.unresolved.filter((item) => item.reason === "NO_MATCHING_ANSWER").map(({ question, controlType, options }) => ({ question, controlType, options }));
  // What the API returns: one Guide entry, one Resume answer, and "none" for the essay question.
  const recognized = { asked, ai: "USED", results: [
    { index: asked.findIndex((item) => /lawfully/.test(item.question)), targetKey: `guide.${AUTH}`, source: "AI" },
    { index: asked.findIndex((item) => /visa petition/.test(item.question)), targetKey: "answer.requires_sponsorship", source: "LEARNED" },
    { index: asked.findIndex((item) => /join us/.test(item.question)), targetKey: null, source: "LEARNED" },
  ] };
  const extended = addRecognizedWordings(definitions.guideEntries, definitions.applicationAnswers, recognized);
  assert.equal(extended.count, 2);
  const second = adapter.detectFields({ root: document, availableKeys: ["candidate.firstName"], applicationAnswers: extended.applicationAnswers, guideEntries: extended.guideEntries });
  assert.deepEqual(second.fields.map((field) => field.key).sort(), ["candidate.firstName", `guide.${AUTH}`, "screening.requires_sponsorship"].sort());
  assert.deepEqual(second.unresolved.map((item) => item.question), ["Why do you want to join us?"]);
  const results = await adapter.fillFields({ root: document, fields: second.fields.map((field) => ({ ...field, value: autofillValue(context, field) })) });
  assert.ok(results.every((result) => result.status === "VERIFIED"), JSON.stringify(results));
  assert.equal(document.querySelector("input[name=q1][value=yes]").checked, true);
  assert.equal(document.getElementById("q2").value, "No");
});

test("a recognized wording still passes the Resume answer safety filters", () => {
  const answers = [{ answerKey: "authorized_to_work", answerType: "BOOLEAN", questionPatterns: ["authorized to work"] }];
  const recognized = { asked: [{ question: "I certify that all information I provided is true and complete" }], results: [{ index: 0, targetKey: "answer.authorized_to_work", source: "AI" }] };
  const extended = addRecognizedWordings([], answers, recognized);
  const { document } = parseHTML(`<!doctype html><html><body><form><label><input type="checkbox" name="c">I certify that all information I provided is true and complete</label></form></body></html>`);
  const { fields } = new GenericHtmlAdapter().detectFields({ root: document, availableKeys: [], applicationAnswers: extended.applicationAnswers, guideEntries: [] });
  assert.equal(fields.length, 0, "attestations are never filled, whatever the model says");
});

test("the side panel asks only for rule-unanswered questions, rescans once, and marks AI-matched fields", () => {
  const app = read("../extension/sidepanel/App.jsx"), service = read("../extension/services/application-service.js"), preview = read("../extension/sidepanel/components/AutofillPreview.jsx");
  assert.match(app, /const askable = \(prepared\.data\.unresolved \|\| \[\]\)\.filter\(\(item\) => item\.reason === "NO_MATCHING_ANSWER"/);
  assert.match(app, /if \(!recovered && askable\.length\)/);
  assert.match(app, /const again = await scan\(extended\)/);
  assert.match(app, /aiMatched: true/);
  assert.match(preview, /field\.aiMatched && <Tag color="purple">AI-matched<\/Tag>/);
  // Wording and option labels only; failures never block Autofill.
  assert.match(service, /item\?\.reason==="NO_MATCHING_ANSWER"/);
  assert.match(service, /\.map\(item=>\(\{question:item\.question\.slice\(0,300\),controlType:item\.controlType,options:/);
  assert.match(service, /catch\{return null;\}/);
});
