import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { personalFieldCandidates } from "../extension/autofill/personal-field-adapter.js";
import { detectUnresolvedQuestions } from "../extension/autofill/screening-field-adapter.js";
import { guideFieldCandidates } from "../extension/autofill/guide-field-adapter.js";
import { choiceGroup } from "../extension/autofill/form-context.js";
import { detectResumeUploadInputs } from "../extension/autofill/resume-upload-adapter.js";

// Gem (jobs.gem.com): no <label>, id, name or aria-label on text boxes; the question is a <span> before the
// field's wrapper. Radios have no name, only an id their option <label for> points to.
const textField = (question, n) => `<div class="flex-30"><span class="bodyImportant-47 primary-51">${question}<span class="requiredAsterisk-76"> *</span></span>
  <div class="textField-77"><div class="inputWrapper-80"><div class="inputElementAndIconWrapper-81"><input class="input-84 input-d${n}-90" type="text"></div></div></div></div>`;
const radioQuestion = (question, prefix) => `<div class="flex-30"><div class="flex-30"><span class="bodyImportant-47 primary-51">${question}<span class="requiredAsterisk-112"> *</span></span></div>
  <div><div class="flex-30"><div class="flex-30"><div class="flex-30">${["Yes", "No"].map((option) => `<div><input class="radioInput-113" id="${prefix}${option}" type="radio">
    <label for="${prefix}${option}" class="label-114"><span class="outerCircle-116"></span><div class="body-48 primary-51">${option}</div></label><div class="helpTextContainer-123"></div></div>`).join("")}
  </div></div></div></div></div>`;
function gemPage() {
  const { document, window } = parseHTML(`<!doctype html><html><body><div class="flex-30">
    ${textField("First name", 0)}${textField("Last name", 1)}${textField("Email", 2)}${textField("LinkedIn profile", 3)}
    ${radioQuestion("Are you legally authorized to work in the United States?", "qa")}
    ${radioQuestion("Will you now or in the future require sponsorship for an employment-authorizing status or visa?", "qb")}
  </div></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}

test("Gem: text boxes are named by the span before their wrapper", () => {
  const keys = personalFieldCandidates(gemPage(), ["candidate.firstName", "candidate.lastName", "candidate.email", "candidate.linkedInUrl"]).map((item) => item.key);
  assert.deepEqual([...new Set(keys)].sort(), ["candidate.email", "candidate.firstName", "candidate.lastName", "candidate.linkedInUrl"]);
});

test("Gem: radios without a name are grouped per question", () => {
  const document = gemPage(), radios = [...document.querySelectorAll("input[type=radio]")];
  assert.deepEqual(choiceGroup(radios[0], radios).map((item) => item.id), ["qaYes", "qaNo"]);
  assert.deepEqual(choiceGroup(radios[3], radios).map((item) => item.id), ["qbYes", "qbNo"]);
});

test("Gem: each radio question is read from its own span, never from an option", () => {
  const items = detectUnresolvedQuestions(gemPage()).filter((item) => item.controlType === "radio");
  assert.deepEqual(items.map((item) => item.question.replace(/\s*\*$/, "")), [
    "Are you legally authorized to work in the United States?",
    "Will you now or in the future require sponsorship for an employment-authorizing status or visa?",
  ]);
  assert.deepEqual(items[0].options, ["Yes", "No"]);
});

test("Gem: an Application Guide answer reaches the nameless radio group", () => {
  const entries = [{ id: "11111111-1111-4111-8111-111111111111", question: "Are you legally authorized to work in the United States?", mode: "FIXED", answer: "Yes" }];
  const [candidate] = guideFieldCandidates(gemPage(), entries);
  assert.ok(candidate, "guide candidate found");
  assert.equal(candidate.elements.length, 2);
});

test("Gem: the resume goes to the Resume box, not the cover letter box", () => {
  const upload = (question) => `<div class="flex-30"><span class="bodyImportant-47 primary-51">${question}<span class="requiredAsterisk-76"> *</span></span>
    <div><div><div class="container-105" role="presentation"><input type="file"><div class="promptContainer-107"><span class="promptText-108">Click to upload or drag and drop here</span></div><em></em></div></div></div></div>`;
  const { document } = parseHTML(`<!doctype html><html><body><div class="flex-30">${upload("Resume")}${upload("Cover letter")}</div></body></html>`);
  const found = detectResumeUploadInputs(document);
  assert.equal(found.length, 1);
  assert.equal(found[0].input, document.querySelectorAll("input[type=file]")[0]);
});
