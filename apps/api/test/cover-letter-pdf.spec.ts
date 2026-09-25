import test from "node:test";
import assert from "node:assert/strict";
import { coverLetterContactLine, coverLetterParagraphs, renderCoverLetterPdf } from "../src/resumes/cover-letter-pdf.renderer.js";

const resume = {
  candidate_name: "Jordan Lee",
  candidate_email: "jordan@example.com",
  candidate_phone: "(555) 010-0000",
  address_city: "Miami",
  address_state_region: "FL",
  linkedin_url: "linkedin.com/in/jordan",
  cover_letter_text: "I am applying for the Data Engineer role.\nIt fits my AWS work.\n\n\nAt Example I build pipelines.",
};

test("cover letter paragraphs rejoin wrapped lines and ignore extra blank lines", () => {
  assert.deepEqual(coverLetterParagraphs(resume.cover_letter_text), [
    "I am applying for the Data Engineer role. It fits my AWS work.",
    "At Example I build pipelines.",
  ]);
  assert.deepEqual(coverLetterParagraphs("  "), []);
});

test("the header contact line comes only from Resume fields that are present", () => {
  assert.equal(coverLetterContactLine(resume), "jordan@example.com  |  (555) 010-0000  |  Miami, FL  |  linkedin.com/in/jordan");
  assert.equal(coverLetterContactLine({ candidate_email: "a@example.com", address_state_region: "FL" }), "a@example.com  |  FL");
});

test("the renderer produces a PDF and refuses an empty letter", async () => {
  const bytes = await renderCoverLetterPdf(resume, new Date("2026-09-25T00:00:00Z"));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 1000);
  await assert.rejects(() => renderCoverLetterPdf({ ...resume, cover_letter_text: "" }), /no text/);
});
