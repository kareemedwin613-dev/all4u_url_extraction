import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { educationFromText, withStructuredEducation } from "../src/shared/legacy-education-parser.js";

// Formats seen in real Resumes: the school after " , " or on its own line, dates after.
const TEXT = "Bachelor of Science (BS), Computer Science , University of Florida 2011 – 2015\nMaster of Science, Data Science\nColumbia University\n2016 – 2017";

test("an upload whose education came out as text gets structured entries, and keeps the text", () => {
  const result = withStructuredEducation({ education: TEXT, summary: "S" });
  assert.equal(result.education_legacy_text, TEXT);
  assert.equal(result.summary, "S");
  assert.deepEqual(result.education.map((item) => item.institution), ["University of Florida", "Columbia University"]);
  assert.ok(result.education.every((item) => item.id && item.degree && item.field_of_study));
  assert.equal(result.education[0].start_date.year, 2011);
});

test("entries the reader already found are kept as they are", () => {
  const found = [{ id: "1", institution: "MIT", degree: "BS", field_of_study: "Physics" }];
  assert.deepEqual(withStructuredEducation({ education: found, education_legacy_text: TEXT }).education, found);
});

test("only entries with a school are kept; the rest become notes to check", () => {
  const { education, warnings } = educationFromText("Coursework in machine learning 2018\nB.S. Mathematics , Stony Brook University 2009 - 2013");
  assert.deepEqual(education.map((item) => item.institution), ["Stony Brook University"]);
  assert.ok(warnings.length >= 1);
  assert.deepEqual(educationFromText("").education, []);
});

test("the upload page structures education and offers to fill it from the text", () => {
  const page = readFileSync(new URL("../src/features/resume-upload/resume-upload-page.jsx", import.meta.url), "utf8");
  const inference = readFileSync(new URL("../src/features/resume-upload/resume-inference.js", import.meta.url), "utf8");
  assert.match(page, /structuredContent=\{\.\.\.withStructuredEducation\(extracted\)/);
  assert.match(inference, /structuredContent=\{\.\.\.withStructuredEducation\(extracted\)/);
  assert.match(page, /Fill education from this text/);
});
