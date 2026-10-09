import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { detectUnresolvedQuestions } from "../extension/autofill/screening-field-adapter.js";
import { evidenceFieldCandidates } from "../extension/autofill/guide-field-adapter.js";
import { evidenceAnswer, questionTerms } from "../extension/autofill/resume-evidence.js";

// Lever (jobs.lever.co …/apply): the question is in <div class="application-label">, each option is a <label>
// wrapping its input, and Yes/No questions are often a pair of checkboxes.
const card = (name, question, type, options) => `<li class="application-question custom-question">
  <div class="application-label"><div class="text">${question}<span class="required">✱</span></div></div>
  <div class="application-field"><ul data-qa="${type}es">${options.map((option) => `<li><label><input type="${type}" name="${name}" value="${option}"><span class="application-answer-alternative">${option}</span></label></li>`).join("")}</ul></div></li>`;
function leverPage() {
  const { document, window } = parseHTML(`<!doctype html><html><body><form><ul>
    ${card("cards[a][field0]", "Are you skilled in C#?", "checkbox", ["Yes, Strong C# skills", "No"])}
    ${card("cards[a][field1]", "This role includes a shared on-call rotation. Are you comfortable with that?", "checkbox", ["Yes", "No"])}
    ${card("surveys[x][age]", "What is your age range?", "radio", ["17 or younger", "18-20", "21-29"])}
    ${card("surveys[x][eth]", "I identify my ethnicity as", "checkbox", ["White / Caucasian", "Asian", "Some other race"])}
    ${card("surveys[x][gender]", "What gender do you identify as?", "radio", ["Female", "Male", "Non-binary"])}
  </ul></form></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}

test("Lever choice questions are read from the question label, never from an option", () => {
  const byQuestion = Object.fromEntries(detectUnresolvedQuestions(leverPage()).map((item) => [item.question.replace(/✱$/, ""), item]));
  assert.ok(byQuestion["This role includes a shared on-call rotation. Are you comfortable with that?"]);
  assert.equal(byQuestion["Yes"], undefined);
  assert.deepEqual(byQuestion["This role includes a shared on-call rotation. Are you comfortable with that?"].options, ["Yes", "No"]);
});

test("age, ethnicity and gender survey questions are left for a person", () => {
  const byQuestion = Object.fromEntries(detectUnresolvedQuestions(leverPage()).map((item) => [item.question.replace(/✱$/, ""), item.reason]));
  assert.equal(byQuestion["What is your age range?"], "REVIEW_REQUIRED");
  assert.equal(byQuestion["I identify my ethnicity as"], "REVIEW_REQUIRED");
  assert.equal(byQuestion["What gender do you identify as?"], "REVIEW_REQUIRED");
});

test("a Yes/No checkbox pair about a skill is answered from the Resume", () => {
  const [candidate] = evidenceFieldCandidates(leverPage());
  assert.equal(candidate.label.replace(/✱$/, ""), "Are you skilled in C#?");
  assert.equal(candidate.controlType, "checkbox");
  assert.equal(candidate.elements.length, 2);
  assert.deepEqual(questionTerms("Are you skilled in C#?").terms, ["c#"]);
  const resume = (skills) => ({ skills, employment: [{ jobTitle: "Engineer", experienceDetails: "Built APIs." }] });
  assert.equal(evidenceAnswer(resume("C#, .NET, SQL"), "Are you skilled in C#?"), "Yes");
  assert.equal(evidenceAnswer(resume("Java, Python"), "Are you skilled in C#?"), "No");
});
