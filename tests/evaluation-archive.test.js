import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("matching launcher is archived before tickets, network or model work", () => {
  const output = execFileSync(process.execPath, ["scripts/worker-runner.mjs", "matching"], { encoding: "utf8", windowsHide: true });
  assert.match(output, /AI evaluation is archived/);
  assert.doesNotMatch(output, /Background matching run/);
});

test("active tailoring entry point never invokes archived score comparison", () => {
  const source = readFileSync("apps/tailoring-worker/src/cli.ts", "utf8");
  assert.doesNotMatch(source, /scoreMaterializedResume|score-comparison/);
  assert.match(source, /submitTailoringBatchPreview/);
});

test("historical UI reads scores without polling or offering evaluation", () => {
  const source = readFileSync("dashboard/src/features/application-matching/application-score-comparison.jsx", "utf8");
  assert.match(source, /getApplicationMatchComparison/);
  assert.match(source, /shouldPoll: \(\) => false/);
  assert.doesNotMatch(source, /requestApplicationMatchComparison|MatchingRunnerCommand|onClick=\{evaluate\}/);
});
