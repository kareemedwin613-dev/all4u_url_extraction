import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Job Description table replaces secondary metadata columns with a clickable source URL",async()=>{
  const source=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  const jobs=source.slice(source.indexOf("function Jobs("),source.indexOf("function Resumes("));
  assert.match(jobs,/title:\s*"Source URL"/);
  assert.match(jobs,/dataIndex:\s*"source_url"/);
  assert.match(jobs,/target="_blank"/);
  assert.doesNotMatch(jobs,/title:\s*"Subcategory"/);
  assert.doesNotMatch(jobs,/title:\s*"Seniority"/);
  assert.doesNotMatch(jobs,/title:\s*"Source site"/);
});
