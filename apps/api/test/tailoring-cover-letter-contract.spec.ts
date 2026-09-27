import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ApiException } from "../src/common/errors/api.exception.js";
import { DtoValidationPipe } from "../src/common/validation/dto-validation.pipe.js";
import { SubmitTailoringBatchPreviewDto } from "../src/platform/tailoring-batch.dto.js";
import { ReviewTailoringPreviewDto, SubmitTailoringPreviewDto, SubmitTailoringRunnerPreviewDto } from "../src/platform/platform.dto.js";

const generatedAt = "2026-09-27T16:41:01.000Z";
const result = {
  summary: "Software engineer experienced in building reliable services.",
  professionalExperience: [{ sourceExperienceId: "exp-1", tailoredDetails: "- Built reliable services with Python." }],
  skills: ["Python"],
  skillGroups: [{ name: "Languages & Runtimes", skills: ["Python"] }],
  changeSummary: [], unsupportedRequirements: [], warnings: [],
};
const coverLetter = "My experience building Python services aligns with this engineering role.\n\nI would welcome a conversation about contributing to your team.";
const batch = {
  ticket: `trb_${"a".repeat(43)}`,
  itemId: "00000000-0000-4000-8000-000000000001",
  leaseToken: "00000000-0000-4000-8000-000000000002",
  generatedAt,
};

test("strict API validation preserves generated cover letters on every submission path", async () => {
  const preview = { ...result, coverLetter };
  const authenticated = await new DtoValidationPipe(SubmitTailoringPreviewDto).transform({ generatedAt, result: preview });
  const runner = await new DtoValidationPipe(SubmitTailoringRunnerPreviewDto).transform({ ticket: `trt_${"a".repeat(43)}`, generatedAt, result: preview });
  const submittedBatch = await new DtoValidationPipe(SubmitTailoringBatchPreviewDto).transform({ ...batch, result: preview });
  const review = await new DtoValidationPipe(ReviewTailoringPreviewDto).transform({ action: "APPROVE", expectedUpdatedAt: generatedAt, preview });
  for (const actual of [authenticated.result, runner.result, submittedBatch.result, review.preview]) {
    assert.equal(actual.coverLetter, coverLetter);
  }
});

test("legacy previews without cover letters still pass strict batch validation", async () => {
  const actual = await new DtoValidationPipe(SubmitTailoringBatchPreviewDto).transform({ ...batch, result });
  assert.equal(actual.result.coverLetter, undefined);
});

test("cover-letter validation accepts the worker's 6000-character limit", async () => {
  const actual = await new DtoValidationPipe(SubmitTailoringBatchPreviewDto).transform({ ...batch, result: { ...result, coverLetter: "a".repeat(6000) } });
  assert.equal(actual.result.coverLetter?.length, 6000);
});

test("malformed cover letters and unrelated fields remain rejected", async () => {
  for (const invalid of [42, {}, [], "", " \n\t", "a".repeat(6001)]) {
    await assert.rejects(
      () => new DtoValidationPipe(SubmitTailoringBatchPreviewDto).transform({ ...batch, result: { ...result, coverLetter: invalid } }),
      (error: unknown) => error instanceof ApiException && error.code === "VALIDATION_ERROR" && Boolean(error.fieldErrors?.["result.coverLetter"]),
    );
  }
  await assert.rejects(
    () => new DtoValidationPipe(SubmitTailoringBatchPreviewDto).transform({ ...batch, result: { ...result, coverLetter, unexpectedField: "not allowed" } }),
    (error: unknown) => error instanceof ApiException && Boolean(error.fieldErrors?.["result.unexpectedField"]),
  );
});
