import test from "node:test";
import assert from "node:assert/strict";
import { DIRECT_SCORE_SCHEMA, SCORING_MODE, directScoringInput, directScoringPrompt, normalizeDirectScore } from "../src/direct-scoring.mjs";
import { WEIGHTS, calculateScore } from "../src/scoring.mjs";

const score = (rating = 70) => ({ sufficient: true, ratings: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, rating])) });
const job = () => ({ scoringMode: SCORING_MODE, asOf: "2026-09-11", jdSource: { title: "Engineer", description: "Build React UIs",
  sections: { responsibilities: "Build React UIs" }, skillHints: ["React"] },
  resumeSource: { name: "PRIVATE_NAME", email: "PRIVATE_EMAIL", outcome: "INTERVIEW_SCHEDULED", summary: "Engineer",
    skills: ["JavaScript", "HTML", "CSS", "React"], experience: [{ title: "Engineer", start: { year: 2020 },
      end: { year: 2025 }, current: false, details: "Built React UIs".repeat(300) }],
    education: [{ degree: "BS", field: "CS" }], certifications: ["AWS"] } });

test("direct schema asks only for five numeric ratings, sufficiency and a short summary", () => {
  assert.deepEqual(DIRECT_SCORE_SCHEMA.required, ["sufficient", "ratings", "summary"]);
  assert.deepEqual(DIRECT_SCORE_SCHEMA.properties.ratings.required, Object.keys(WEIGHTS));
  assert.equal(DIRECT_SCORE_SCHEMA.additionalProperties, false);
  for (const definition of Object.values(DIRECT_SCORE_SCHEMA.properties.ratings.properties)) {
    assert.deepEqual(definition.type, ["integer", "null"]);
    assert.equal(definition.minimum, 0); assert.equal(definition.maximum, 100);
  }
  assert.ok(directScoringPrompt().length < 2200);
});

test("source preparation removes duplicated JD sections and identity fields, preserving all role evidence", () => {
  const inputJob = job(), prepared = directScoringInput(inputJob);
  assert.equal(prepared.sufficient, true);
  assert.equal(Object.hasOwn(prepared.input.jd, "sections"), false);
  assert.deepEqual(prepared.input.resume.experience, inputJob.resumeSource.experience);
  assert.deepEqual(prepared.input.resume.skills, inputJob.resumeSource.skills);
  assert.deepEqual(prepared.input.resume.education, inputJob.resumeSource.education);
  assert.deepEqual(prepared.input.resume.certifications, ["AWS"]);
  assert.equal(prepared.input.asOf, "2026-09-11");
  assert.doesNotMatch(JSON.stringify(prepared), /PRIVATE_|INTERVIEW_SCHEDULED/);
  inputJob.jdSource.description = " ";
  assert.deepEqual(directScoringInput(inputJob).input.jd.sections, inputJob.jdSource.sections);
  assert.equal(directScoringInput(inputJob).sufficient, true);
});

test("missing source content is insufficient; an incompatible backend stops the worker", () => {
  const noJd = job(); noJd.jdSource = { title: "Engineer" };
  assert.equal(directScoringInput(noJd).sufficient, false);
  for (const experience of [undefined, [], [{ title: "Engineer" }], [{ details: " " }]]) {
    const noExperience = job(); noExperience.resumeSource.experience = experience;
    assert.equal(directScoringInput(noExperience).sufficient, false);
  }
  for (const broken of [{ ...job(), scoringMode: undefined }, { ...job(), jdSource: null }, { ...job(), resumeSource: [] }]) {
    assert.throws(() => directScoringInput(broken), error => error.code === "DATABASE_MIGRATION_REQUIRED" && error.stopWorker);
  }
});

test("only essential numeric and sufficiency failures reject model content", () => {
  for (const rating of ["80", 70.5, -1, 101, {}, undefined]) {
    const invalid = score(); invalid.ratings.requiredSkills = rating;
    assert.throws(() => normalizeDirectScore(invalid), error => error.code === "INVALID_MODEL_OUTPUT");
  }
  for (const invalid of [null, {}, { ...score(), ratings: [] }, { ...score(), sufficient: "true" },
    { ...score(), sufficient: false }, score(null)]) {
    assert.throws(() => normalizeDirectScore(invalid), error => error.code === "INVALID_MODEL_OUTPUT");
  }
  for (const rating of [0, 69, 70, 100]) assert.equal(calculateScore(normalizeDirectScore(score(rating))), Math.max(1, rating));
  const absentFacet = score(); absentFacet.ratings.domain = null;
  assert.equal(calculateScore(normalizeDirectScore(absentFacet)), 70);
  assert.equal(calculateScore(normalizeDirectScore({ ...score(null), sufficient: false })), null);
});

test("optional text and extra fields are normalized instead of triggering another model call", () => {
  for (const summary of [undefined, null, 42, {}, [], "x".repeat(501)]) {
    const result = normalizeDirectScore({ ...score(), summary, sourceQuotes: ["not a quote"], missingRequirements: "wrong type" });
    assert.equal(calculateScore(result), 70);
    assert.equal(result.summary, typeof summary === "string" ? "x".repeat(500) : "");
    assert.deepEqual(result.missingRequirements, []);
    assert.ok(Object.values(result.components).every(component => component.reason === ""));
  }
});
