import test from "node:test";
import assert from "node:assert/strict";
import { guideEntryIsUpdated, guideEntryMatches, sortGuideEntries } from "../src/features/application-guide/application-guide.js";

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

test("application guide search matches the question text", () => {
  assert.equal(guideEntryMatches(entry, { search: "address line 2" }), true);
  assert.equal(guideEntryMatches(entry, { search: "salary" }), false);
  assert.equal(guideEntryMatches(entry, { search: "confirmed" }), true);
  assert.equal(guideEntryMatches({ ...entry, exampleAnswer: "" }, { search: "example st" }), false);
});

test("application guide sorts questions from A to Z", () => {
  const rows = [
    { id: "b", question: "Do you consent to AI evaluating your candidacy?" },
    { id: "a", question: "What goes in Home Address and Address Line 2?" },
    { id: "c", question: "Does \"Location\" mean the company office or home address?" },
  ];
  assert.deepEqual(sortGuideEntries(rows).map((row) => row.id), ["b", "c", "a"]);
  assert.deepEqual(sortGuideEntries(rows, "desc").map((row) => row.id), ["a", "c", "b"]);
});

test("application guide marks a recent published edit as updated", () => {
  const now = Date.parse("2026-10-05T16:00:00.000Z");
  assert.equal(guideEntryIsUpdated(entry, now), false);
  assert.equal(guideEntryIsUpdated({ ...entry, updatedAt: "2026-10-05T15:00:00.000Z" }, now), true);
  assert.equal(guideEntryIsUpdated({ ...entry, status: "DRAFT", updatedAt: "2026-10-05T15:00:00.000Z" }, now), false);
  assert.equal(guideEntryIsUpdated({ ...entry, updatedAt: "2026-09-01T15:00:00.000Z" }, now), false);
});
