import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Job Descriptions page mounts a FilterPanel-backed filter section", async () => {
  const [app, filters] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/jobs/job-list-filters.jsx"),
  ]);
  assert.match(app, /<JobListFilters/);
  assert.match(app, /from "\.\/features\/jobs\/job-list-filters\.jsx"/);
  assert.match(filters, /export function JobListFilters/);
  assert.match(filters, /<FilterPanel/);
  assert.match(filters, /countActiveJobFilters/);
  assert.match(filters, /Company/);
  assert.match(filters, /Job title/);
  assert.match(filters, /Job Posting URL/);
  assert.match(filters, /sourceUrl/);
  assert.doesNotMatch(filters, />Search</);
  assert.match(filters, /Captured by/);
  assert.match(filters, /Review status/);
  assert.match(filters, /Clear filters/);
});
