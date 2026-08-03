import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const service=readFileSync(new URL("../../apps/api/src/resumes/resume.service.ts",import.meta.url),"utf8");
const applicationPage=readFileSync(new URL("../src/features/applications/application-pages.jsx",import.meta.url),"utf8");

test("Resume dashboard identifies original Resumes by decimal number",()=>{
  assert.match(app,/title: "Resume #"/);
  assert.match(app,/dataIndex: "resume_number"/);
  assert.match(app,/resume\.resume_name.*resume\.resume_number/s);
  assert.match(app,/\["Resume type", formatLabel\(resume\.resume_type/);
});

test("general Resume API reads, counts, and recent cards are original-only",()=>{
  assert.match(service,/\.eq\("resume_type","ORIGINAL"\)/);
  assert.match(service,/RESUME_LIST_FIELDS="id,resume_number,resume_type,parent_resume_id/);
  assert.match(service,/storage\.from\(row\.storage_bucket\)/);
});

test("Application Resume picker includes the Resume number",()=>{
  assert.match(applicationPage,/x\.resume_number \? ` #\$\{x\.resume_number\}`/);
});
