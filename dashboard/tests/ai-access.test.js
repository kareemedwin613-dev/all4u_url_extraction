import test from "node:test";
import assert from "node:assert/strict";
import { AI_LEVELS, aiLevelLabel, applierAiRows, withLevel } from "../src/features/overview/ai-access.js";

test("AI access levels: Off, Match questions, Match + draft answers", () => {
  assert.deepEqual(AI_LEVELS.map((level) => level.value), ["OFF", "MATCH", "DRAFT"]);
  assert.equal(aiLevelLabel("DRAFT"), "Match + draft answers");
  assert.equal(aiLevelLabel("unknown"), "Off");
});

test("access rows coerce numbers, show unknown levels as Off, and total the period", () => {
  const { rows, totals, withAccess } = applierAiRows({ appliers: [
    { userId: "u1", name: "Jane", level: "MATCH", aiRuns: "3", autofillRuns: 10, questionsMatched: 4, costMicroUsd: 1500 },
    { userId: "u2", email: "sam@example.com", level: "SOMETHING", active: false },
    { name: "No id" },
  ] });
  assert.deepEqual(rows.map((row) => [row.name, row.level, row.active, row.aiRuns]), [["Jane", "MATCH", true, 3], ["sam@example.com", "OFF", false, 0]]);
  assert.equal(totals.costMicroUsd, 1500);
  assert.equal(totals.autofillRuns, 10);
  assert.equal(withAccess, 1);
  assert.deepEqual(applierAiRows(null), { rows: [], totals: applierAiRows({}).totals, withAccess: 0 });
});

test("changing one person's level leaves the others alone", () => {
  const { rows } = applierAiRows({ appliers: [{ userId: "u1", level: "OFF" }, { userId: "u2", level: "MATCH" }] });
  assert.deepEqual(withLevel(rows, "u1", "DRAFT").map((row) => row.level), ["DRAFT", "MATCH"]);
});
