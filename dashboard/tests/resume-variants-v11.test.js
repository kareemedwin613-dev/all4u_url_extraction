import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const service=readFileSync(new URL("../../apps/api/src/resumes/resume.service.ts",import.meta.url),"utf8");
const applicationPage=readFileSync(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");

test("Resume dashboard identifies original Resumes by decimal number",()=>{
  assert.match(app,/title: "No"/);
  assert.match(app,/filters\.pageSize \|\| 25/);
  assert.match(app,/resume\.resume_name.*resume\.resume_number/s);
  assert.match(app,/\["Resume Type", formatLabel\(resume\.resume_type/);
  assert.match(app,/\["Resume Number", resume\.resume_number/);
});

test("Resume list places Status after Updated",()=>{
  const start=app.indexOf('title: "No"');
  const end=app.indexOf("filters.sort", start);
  assert.ok(start>=0 && end>start, "Resume list columns are defined");
  const list=app.slice(start, end);
  const order=["Seniority","File Type","Cover Letter","Updated","Status"].map((title)=>list.indexOf(`title: "${title}"`));
  assert.ok(order.every((index)=>index>=0), "expected Resume list columns are present");
  assert.deepEqual(order, [...order].sort((a,b)=>a-b));
});

test("Resume list opens cover letters through a signed URL when attached",()=>{
  assert.match(app,/title: "Cover Letter"/);
  assert.match(app,/cover_letter_storage_path/);
  assert.match(app,/createCoverLetterSignedUrl/);
  assert.match(app,/cover_letter_original_filename/);
  assert.match(service,/cover_letter_storage_path,cover_letter_original_filename/);
});

test("general Resume API reads, counts, and recent cards are original-only",()=>{
  assert.match(service,/\.eq\("resume_type","ORIGINAL"\)/);
  assert.match(service,/RESUME_LIST_FIELDS="id,resume_number,resume_type,parent_resume_id/);
  assert.match(service,/storage\.from\(row\.storage_bucket\)/);
});

test("Application Resume picker includes the Resume Number",()=>{
  assert.match(applicationPage,/x\.resume_number \? ` #\$\{x\.resume_number\}`/);
});
