import test from "node:test";
import assert from "node:assert/strict";
import { buildAutofillTelemetry, mergeAutofillResults } from "../extension/autofill/session-telemetry.js";

test("v0.9.4 builds aggregate and normalized field feedback without values or labels", () => {
  const telemetry = buildAutofillTelemetry({
    resumeUpdatedAt: "2026-08-02T12:00:00Z",
    adapter: { id: "greenhouse", version: "1.0.0" },
    targetDomain: "JOB-BOARDS.GREENHOUSE.IO",
    fields: [
      { fieldId: "first", key: "candidate.firstName", label: "First name", confidence: 91, value: "Secret" },
      { fieldId: "phone", key: "candidate.phone", label: "Phone", confidence: 93, value: "+1 555" },
    ],
    selectedFieldIds: ["first", "phone"],
    results: [{ fieldId: "first", status: "VERIFIED", code: "FIELD_VERIFIED" }, { fieldId: "phone", status: "FAILED", code: "FIELD_VERIFICATION_FAILED" }],
    unresolved: [{ question: "Sensitive question text" }],
  });
  assert.equal(telemetry.targetDomain, "job-boards.greenhouse.io");
  assert.deepEqual([telemetry.detectedCount, telemetry.selectedCount, telemetry.succeededCount, telemetry.failedCount, telemetry.unresolvedCount], [2, 2, 1, 1, 1]);
  assert.deepEqual(telemetry.fields[0], { fieldKey: "candidate.firstName", fieldIndex: 0, confidence: 91, outcome: "VERIFIED", errorCode: "FIELD_VERIFIED" });
  const serialized = JSON.stringify(telemetry);
  assert.doesNotMatch(serialized, /Secret|First name|Sensitive question|\+1 555/);
});

test("v0.9.4 merges retry results without losing previously verified fields", () => {
  assert.deepEqual(mergeAutofillResults([{ fieldId: "a", status: "VERIFIED" }, { fieldId: "b", status: "FAILED" }], [{ fieldId: "b", status: "VERIFIED" }]), [{ fieldId: "a", status: "VERIFIED" }, { fieldId: "b", status: "VERIFIED" }]);
});
