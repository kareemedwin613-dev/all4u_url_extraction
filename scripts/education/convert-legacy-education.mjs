#!/usr/bin/env node
// One-time conversion of original Resumes' free-text education into structured education entries,
// so Autofill can fill School / Degree / Major / dates.
//
//   node scripts/education/convert-legacy-education.mjs [--out <folder>] [--include-archived]
//
// Reads production through the linked Supabase CLI in a read-only transaction and writes, outside the
// repository by default (the files contain candidate data):
//   education-review.html   every Resume's original text beside the proposed entries and warnings
//   education-apply.sql     guarded updates for a reviewer to run after checking the review page
// It never writes to the database. After review, apply with:
//   npx supabase db query --linked -f <folder>/education-apply.sql
// Each update only runs if the Resume still has no structured education and its free text is unchanged.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseLegacyEducation } from "./legacy-education-parser.mjs";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const out = resolve(option("--out") || join(tmpdir(), `resume-education-conversion-${new Date().toISOString().slice(0, 10)}`));
const statuses = args.includes("--include-archived") ? "('ACTIVE','ARCHIVED')" : "('ACTIVE')";

const query = `begin transaction read only;
select id, status, resume_name, candidate_name, structured_content->>'education_legacy_text' as legacy
from public.resumes
where resume_type = 'ORIGINAL' and status in ${statuses}
  and nullif(btrim(coalesce(structured_content->>'education_legacy_text', '')), '') is not null
  and coalesce(jsonb_array_length(case when jsonb_typeof(structured_content->'education') = 'array' then structured_content->'education' end), 0) = 0
order by candidate_name, resume_name;
commit;`;

// The query goes through a file: Windows shells mangle multi-line arguments.
const queryFile = join(mkdtempSync(join(tmpdir(), "education-query-")), "read.sql");
writeFileSync(queryFile, query);
let raw;
try {
  raw = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "supabase", "db", "query", "--linked", "--output-format", "json", "-f", `"${queryFile}"`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true });
} finally {
  rmSync(dirname(queryFile), { recursive: true, force: true });
}
const rows = JSON.parse(raw).rows || [];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateText = (date) => (date ? `${date.month ? `${String(date.month).padStart(2, "0")}/` : ""}${date.year}` : "—");
const tag = `edu_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dollar = (text) => { if (String(text).includes(`$${tag}$`)) throw new Error("Unexpected text in legacy education."); return `$${tag}$${text}$${tag}$`; };

const statements = [], sections = [];
let entryCount = 0, warningCount = 0, skipped = 0;
for (const row of rows) {
  const parsed = parseLegacyEducation(row.legacy);
  const usable = parsed.filter(({ entry }) => entry.institution);
  skipped += parsed.length - usable.length;
  entryCount += usable.length;
  warningCount += parsed.filter(({ warnings }) => warnings.length).length;
  if (usable.length) {
    const education = usable.map(({ entry }) => ({ id: randomUUID(), ...entry }));
    statements.push(`update public.resumes
set structured_content = jsonb_set(coalesce(structured_content, '{}'::jsonb), '{education}', ${dollar(JSON.stringify(education))}::jsonb),
    structured_schema_version = greatest(structured_schema_version, 3)
where id = '${row.id}' and resume_type = 'ORIGINAL'
  and coalesce(jsonb_array_length(case when jsonb_typeof(structured_content->'education') = 'array' then structured_content->'education' end), 0) = 0
  and structured_content->>'education_legacy_text' = ${dollar(row.legacy)};`);
  }
  sections.push(`<section${parsed.some(({ warnings }) => warnings.length) || usable.length !== parsed.length ? ' class="warn"' : ""}>
  <h2>${escapeHtml(row.candidate_name || "Unnamed")} <small>${escapeHtml(row.resume_name || "")} · ${escapeHtml(row.status)} · ${escapeHtml(row.id)}</small></h2>
  <div class="grid"><pre>${escapeHtml(row.legacy)}</pre>
  <table><thead><tr><th>School</th><th>Degree</th><th>Field of study</th><th>Start</th><th>End</th><th>Check</th></tr></thead><tbody>
  ${parsed.map(({ entry, warnings }) => `<tr><td>${escapeHtml(entry.institution) || "<em>missing — not applied</em>"}</td><td>${escapeHtml(entry.degree)}</td><td>${escapeHtml(entry.field_of_study)}</td><td>${dateText(entry.start_date)}</td><td>${dateText(entry.end_date)}</td><td>${escapeHtml(warnings.join(" "))}</td></tr>`).join("\n  ")}
  </tbody></table></div>
</section>`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "education-apply.sql"), `-- Generated ${new Date().toISOString()} for ${rows.length} original Resumes (${entryCount} education entries).
-- Review education-review.html first. Each update is skipped if the Resume changed since this file was generated.
begin;
${statements.join("\n\n")}
commit;
`);
writeFileSync(join(out, "education-review.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Education conversion review</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1f2937}section{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:12px 0}section.warn{border-color:#f59e0b;background:#fffbeb}
h2{font-size:16px;margin:0 0 8px}small{color:#6b7280;font-weight:400}.grid{display:grid;grid-template-columns:minmax(220px,1fr) 3fr;gap:16px}pre{white-space:pre-wrap;margin:0;background:#f9fafb;padding:8px;border-radius:6px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e5e7eb;padding:4px 6px;text-align:left;vertical-align:top}</style></head><body>
<h1>Education conversion review</h1>
<p>${rows.length} original Resumes · ${entryCount} entries to apply · ${warningCount} entries flagged (amber) · ${skipped} without a school name, which will not be applied. Fix flagged Resumes in the dashboard's Structured Resume editor after applying, or before applying by editing their free text.</p>
${sections.join("\n")}
</body></html>`);

console.log(`Read ${rows.length} original Resumes. Proposed ${entryCount} education entries (${warningCount} flagged, ${skipped} skipped).`);
console.log(`Review: ${join(out, "education-review.html")}`);
console.log(`After review, apply with: npx supabase db query --linked -f "${join(out, "education-apply.sql")}"`);
