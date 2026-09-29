import test from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { resumeEducationEntries } from "../src/platform/tailored-resume-layout.js";
import { renderTailoredResumePdf } from "../src/platform/tailored-resume-pdf.renderer.js";
import { REFERENCE_RESUME_LAYOUTS } from "../src/platform/reference-resume-templates.js";
import { referenceResumeFixture } from "./fixtures/reference-resume.mjs";

const parse = (text: string) => resumeEducationEntries({ education: [], education_legacy_text: text }).map(({ degree, institution, range }) => ({ degree, institution, range }));

// Synthetic examples of every plain-text shape stored in production (school/degree/date order, single line, multiple entries).
test("plain-text education becomes degree, school, and date entries", () => {
  assert.deepEqual(parse("Example University\nBachelor's Degree\n2010 – 2014"), [{ degree: "Bachelor's Degree", institution: "Example University", range: "2010 – 2014" }]);
  assert.deepEqual(parse("Master of Computer Science\nExample Institute of Technology\n2013 - 2014"), [{ degree: "Master of Computer Science", institution: "Example Institute of Technology", range: "2013 – 2014" }]);
  assert.deepEqual(parse("Bachelor of Science (B.S.), Computer Science, Example University , Boston, MA 2010 – 2014"), [{ degree: "Bachelor of Science (B.S.), Computer Science", institution: "Example University", range: "2010 – 2014" }]);
  assert.deepEqual(parse("Example College\nBachelor of Arts\n09/2008 – 05/2012\nExample University\nMaster of Science\n09/2012 – 05/2014"), [
    { degree: "Bachelor of Arts", institution: "Example College", range: "09/2008 – 05/2012" },
    { degree: "Master of Science", institution: "Example University", range: "09/2012 – 05/2014" },
  ]);
  assert.deepEqual(parse("Bachelor of Science\nExample College\nMaster of Science\nExample University"), [
    { degree: "Bachelor of Science", institution: "Example College", range: "" },
    { degree: "Master of Science", institution: "Example University", range: "" },
  ]);
  assert.deepEqual(parse("Example University\nBachelor of Science, Computer Science - Minor\nBachelor of Arts\n2010 – 2014"), [{ degree: "Bachelor of Science, Computer Science - Minor, Bachelor of Arts", institution: "Example University", range: "2010 – 2014" }]);
  assert.deepEqual(parse("Example College 2012\nAssociate of Arts"), [{ degree: "Associate of Arts", institution: "Example College", range: "2012" }]);
  assert.deepEqual(parse("2014 - 2018 B.S. Computer Science"), [{ degree: "B.S. Computer Science", institution: "", range: "2014 – 2018" }]);
  assert.deepEqual(parse("Computer Science\nExample University\n2019 - present"), [{ degree: "Computer Science", institution: "Example University", range: "2019 – Present" }]);
});

test("school names with commas or state codes are not split into a degree", () => {
  assert.deepEqual(parse("University of California, Berkeley\nBachelor of Arts\n2008 – 2012"), [{ degree: "Bachelor of Arts", institution: "University of California, Berkeley", range: "2008 – 2012" }]);
  assert.deepEqual(parse("Example University, Boston, MA\n2008 – 2012"), [{ degree: "", institution: "Example University, Boston, MA", range: "2008 – 2012" }]);
});

test("structured education entries keep degree, field, GPA, school, and dates", () => {
  assert.deepEqual(resumeEducationEntries({ education: [{ institution: "Example University", degree: "Bachelor of Science", field_of_study: "Computer Science", gpa: "3.8", start_date: { year: 2008 }, end_date: { year: 2012, month: 5 } }] }),
    [{ degree: "Bachelor of Science, Computer Science, GPA: 3.8", institution: "Example University", range: "2008 – 05/2012", details: "" }]);
});

async function lines(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise, rows: { page: number; y: number; text: string[] }[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      for (const item of content.items as any[]) {
        if (!item.str?.trim()) continue;
        const y = Math.round(item.transform[5]), row = rows.find(r => r.page === n && Math.abs(r.y - y) <= 2);
        if (row) row.text.push(item.str.trim()); else rows.push({ page: n, y, text: [item.str.trim()] });
      }
    }
  } finally { await pdf.destroy(); }
  return rows.map(row => ({ ...row, line: row.text.join(" ") }));
}

for (const key of [...REFERENCE_RESUME_LAYOUTS.map(spec => spec.key), "MODERN_V1"]) test(`${key}: no role location; education shows degree with dates, then school`, async () => {
  const input: any = referenceResumeFixture(false);
  input.renderTemplateKey = key;
  input.sourceStructuredContent.professional_experience = input.sourceStructuredContent.professional_experience.map((role: any) => ({ ...role, location: "Remote Location Marker" }));
  input.sourceStructuredContent.education = [];
  input.sourceStructuredContent.education_legacy_text = "Example State University\nBachelor's Degree\n2010 – 2014";
  const rows = await lines(await renderTailoredResumePdf(input));
  assert.ok(!rows.some(row => row.line.includes("Remote Location Marker")), "role locations must not be rendered");
  const degree = rows.findIndex(row => row.line.includes("Bachelor's Degree"));
  assert.ok(degree >= 0, "degree must be rendered");
  assert.match(rows[degree].line.replace(/\s+/g, " "), /2010 – 2014/, "dates share the degree's line");
  // Stacked (school on the next line) unless only the one-line fallback fits on the page.
  assert.ok(rows.slice(degree).some(row => row.page >= rows[degree].page && row.line.includes("Example State University")), "school follows the degree");
});
