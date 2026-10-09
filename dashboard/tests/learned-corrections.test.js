import test from "node:test";
import assert from "node:assert/strict";
import { correctionBody, correctionOptions, correctionValue, learnedTargetLabel } from "../src/features/application-guide/application-guide.js";

test("correction choices: contact fields, published standard answers, Resume answers, kinds of question", () => {
  const groups = correctionOptions([
    { id: "g1", question: "Are you authorized to work in the US?", status: "PUBLISHED", autofillMode: "FIXED" },
    { id: "g2", question: "Guidance only", status: "PUBLISHED", autofillMode: "NONE" },
    { id: "g3", question: "Unpublished", status: "DRAFT", autofillMode: "FIXED" },
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["Contact field", "Standard answer", "Resume answer", "No standard answer"]);
  assert.deepEqual(groups[1].options, [{ value: "guide.g1", label: "Are you authorized to work in the US?" }]);
  assert.ok(groups[0].options.some((option) => option.value === "field.linkedInUrl" && option.label === "LinkedIn URL"));
  assert.ok(groups[3].options.some((option) => option.value === "none:ESSAY"));
});

test("a correction becomes the API body, and the current target preselects", () => {
  assert.deepEqual(correctionBody("field.linkedInUrl"), { targetKey: "field.linkedInUrl" });
  assert.deepEqual(correctionBody("none:NOT_A_QUESTION"), { targetKey: "none", answerKind: "NOT_A_QUESTION" });
  assert.equal(correctionValue({ targetKey: "none", answerKind: "ESSAY" }), "none:ESSAY");
  assert.equal(correctionValue({ targetKey: "guide.g1" }), "guide.g1");
  assert.equal(learnedTargetLabel({ targetKey: "field.linkedInUrl" }), "Contact field: LinkedIn URL");
  assert.equal(learnedTargetLabel({ targetKey: "none", answerKind: "ESSAY" }), "Open-ended: for AI drafting");
});
