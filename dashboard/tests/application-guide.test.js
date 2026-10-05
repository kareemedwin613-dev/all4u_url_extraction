import test from "node:test";
import assert from "node:assert/strict";
import { guideEntryIsUpdated, guideEntryMatches } from "../src/features/application-guide/application-guide.js";

const entry = {
  question: "What goes in Home Address and Address Line 2?",
  meaning: "Home Address is the street number and street name.",
  howToAnswer: "Use the candidate's confirmed address.",
  exampleAnswer: "123 Example St",
  category: "PERSONAL_DETAILS",
  status: "PUBLISHED",
  publishedAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
};

test("application guide search matches the question and hides other categories", () => {
  assert.equal(guideEntryMatches(entry, { search: "address line 2" }), true);
  assert.equal(guideEntryMatches(entry, { search: "salary" }), false);
  assert.equal(guideEntryMatches(entry, { category: "CONSENT" }), false);
  assert.equal(guideEntryMatches(entry, { search: "confirmed", category: "PERSONAL_DETAILS" }), true);
});

test("application guide marks a recent published edit as updated", () => {
  const now = Date.parse("2026-10-05T16:00:00.000Z");
  assert.equal(guideEntryIsUpdated(entry, now), false);
  assert.equal(guideEntryIsUpdated({ ...entry, updatedAt: "2026-10-05T15:00:00.000Z" }, now), true);
  assert.equal(guideEntryIsUpdated({ ...entry, status: "DRAFT", updatedAt: "2026-10-05T15:00:00.000Z" }, now), false);
  assert.equal(guideEntryIsUpdated({ ...entry, updatedAt: "2026-09-01T15:00:00.000Z" }, now), false);
});
