import test from "node:test";
import assert from "node:assert/strict";
import { cleanCoverLetterBody, joinPdfLines } from "../src/features/cover-letters/cover-letter-text.js";

test("the base letter keeps only body paragraphs between the greeting and the sign-off", () => {
  const raw = [
    "Jordan Lee", "Data Engineer", "jordan@example.com (555) 010-0000 Miami, FL", "Dear Hiring Manager,",
    "I am writing to express my interest in a Data Engineering opportunity. With nine",
    "years of experience building reliable data pipelines.", "",
    "In my current role, I build AWS Glue pipelines.", "",
    "Sincerely,", "Jordan Lee",
  ].join("\r\n");
  assert.equal(cleanCoverLetterBody(raw), "I am writing to express my interest in a Data Engineering opportunity. With nine years of experience building reliable data pipelines.\n\nIn my current role, I build AWS Glue pipelines.");
});

test("a letter without a greeting or sign-off is kept whole", () => {
  assert.equal(cleanCoverLetterBody("First paragraph.\n\n\n\nSecond paragraph.\nThank you for reading my letter."), "First paragraph.\n\nSecond paragraph. Thank you for reading my letter.");
});

test("PDF paragraph breaks come from vertical gaps larger than normal line spacing", () => {
  const lines = [
    { page: 1, y: 700, text: "Dear Hiring Manager," },
    { page: 1, y: 670, text: "First paragraph line one," },
    { page: 1, y: 656, text: "line two." },
    { page: 1, y: 628, text: "Second paragraph." },
    { page: 1, y: 614, text: "Continues here." },
    { page: 2, y: 700, text: "Third paragraph on a new page." },
  ];
  assert.equal(cleanCoverLetterBody(joinPdfLines(lines)), "First paragraph line one, line two.\n\nSecond paragraph. Continues here.\n\nThird paragraph on a new page.");
});
