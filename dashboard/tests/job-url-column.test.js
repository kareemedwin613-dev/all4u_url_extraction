import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Job Description table shows the full clickable job-posting URL", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const jobs = source.slice(
    source.indexOf("function Jobs("),
    source.indexOf("function Resumes("),
  );
  assert.match(jobs, /title:\s*"Job Posting URL"/);
  assert.match(jobs, /dataIndex:\s*"source_url"/);
  assert.match(jobs, /safeExternalUrl/);
  assert.match(jobs, /EllipsisCell href=\{source\}/);
  assert.doesNotMatch(jobs, /ellipsis:\s*true/);
  assert.doesNotMatch(jobs, /title:\s*"Subcategory"/);
  assert.doesNotMatch(jobs, /title:\s*"Source Site"/);
});
