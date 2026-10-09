import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEARNED_KINDS, filterLearnedWordings, guideEntryFromLearned } from "../src/features/application-guide/application-guide.js";

const items = [
  { id: "1", question: "Open to hybrid, 3 days a week?", targetKey: "none", answerKind: "SAME_FOR_EVERYONE" },
  { id: "2", question: "Why us?", targetKey: "none", answerKind: "ESSAY" },
  { id: "3", question: "Location", targetKey: "guide.x" },
  { id: "4", question: "Old row", targetKey: "none", answerKind: null },
];

test("Learned by AI filters: questions needing a standard answer, matched, and no standard answer", () => {
  assert.deepEqual(filterLearnedWordings(items, "NEEDS_ANSWER").map((item) => item.id), ["1"]);
  assert.deepEqual(filterLearnedWordings(items, "MATCHED").map((item) => item.id), ["3"]);
  assert.deepEqual(filterLearnedWordings(items, "NO_ANSWER").map((item) => item.id), ["1", "2", "4"]);
  assert.equal(filterLearnedWordings(items, "ALL").length, 4);
  assert.equal(LEARNED_KINDS.SAME_FOR_EVERYONE.label, "Needs a standard answer");
});

test("Add standard answer starts a guide entry with a fixed answer and the employer's wording", () => {
  const entry = guideEntryFromLearned(items[0], { question: "", meaning: "", howToAnswer: "", autofillMode: "NONE", autofillPatterns: [] });
  assert.equal(entry.question, "Open to hybrid, 3 days a week?");
  assert.equal(entry.autofillMode, "FIXED");
  assert.deepEqual(entry.autofillPatterns, ["Open to hybrid, 3 days a week?"]);
  assert.equal(entry.fromLearnedId, "1");
});

test("publishing that entry removes the learned 'no standard answer' row; a draft keeps it", () => {
  const page = readFileSync(new URL("../src/features/application-guide/application-guide-page.jsx", import.meta.url), "utf8");
  assert.match(page, /if \(status === "PUBLISHED" && fromLearnedId\) \{\s*await removeLearnedAutofillWording\(client, apiBaseUrl, fromLearnedId\)/);
  assert.match(page, /const \{ autofillMode, autofillValue, autofillSource, autofillPatterns, autofillSensitive, fromLearnedId, \.\.\.content \} = editor;/, "the helper id is never sent with the entry");
});
