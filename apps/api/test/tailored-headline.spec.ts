import test from "node:test";
import assert from "node:assert/strict";
import { tailoredHeadline } from "../src/platform/tailored-headline.js";

const cases: Array<[string, string, string, string | null]> = [
  // [job title, resume seniority, company, expected headline]
  ["Senior Data Engineer", "SENIOR", "", "Senior Data Engineer"],
  ["Data Engineer II", "SENIOR", "", "Data Engineer"],
  ["Sr. Software Engineer II - Billing & Subscriptions Engineering (Remote Eligible)", "SENIOR", "", "Senior Software Engineer"],
  ["Senior Software Engineer, Backend", "SENIOR", "", "Senior Software Engineer, Backend"],
  ["Software Engineer - Frontend", "SENIOR", "", "Software Engineer, Frontend"],
  ["AI Engineer (Agents) - Remote Work | REF#302676", "SENIOR", "", "AI Engineer"],
  ["Cloud Engineer L3", "SENIOR", "", "Cloud Engineer"],
  // Never above the Resume's seniority, and a title's two level words collapse to one.
  ["Staff Software Engineer, AI Enablement | Root Insurance", "SENIOR", "Root Insurance", "Senior Software Engineer, AI Enablement"],
  ["Sr Principal Data Scientist", "SENIOR", "", "Senior Data Scientist"],
  ["Senior Principal Software Engineer (REMOTE)", "LEAD", "", "Lead Software Engineer"],
  ["Staff+ Software Engineer, AI", "SENIOR", "", "Senior Software Engineer, AI"],
  ["Principal Data Engineer", "PRINCIPAL", "", "Principal Data Engineer"],
  ["Lead Data Engineer", "MID", "", "Data Engineer"],
  ["Senior Data Engineer", "UNSPECIFIED", "", "Data Engineer"],
  // Company names, plural postings, "Founding", and management titles for IC Resumes.
  ["Data Engineer - Acme Corp", "SENIOR", "Acme Corp", "Data Engineer"],
  ["Founding Frontend Engineer (Mobile, Social)", "SENIOR", "", "Frontend Engineer"],
  ["Data Engineers Databricks / PySpark - Full Remote", "SENIOR", "", null],
  ["Engineering Manager, Cloud Engineering", "SENIOR", "", null],
  ["Engineering Manager, Cloud Engineering", "MANAGER", "", "Engineering Manager, Cloud Engineering"],
  ["Backend-Node JS", "SENIOR", "", null],
];

test("the headline is the cleaned job title, capped at the Resume's seniority", () => {
  for (const [title, seniority, company, expected] of cases) assert.equal(tailoredHeadline(title, seniority, company), expected, `${title} (${seniority})`);
});
