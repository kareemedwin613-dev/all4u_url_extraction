import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  JOB_EXPORT_HEADERS,
  JOB_EXPORT_MAX_ROWS,
  JOB_EXPORT_PAGE_SIZE,
  fetchAllFilteredJobs,
  jobsToWorkbookRows,
} from "../src/services/job-export-service.js";

test("job export workbook rows use the locked column order", () => {
  assert.deepEqual(JOB_EXPORT_HEADERS, [
    "Company Name",
    "Role Name",
    "Job Description URL",
    "Founded By",
    "Founded Date",
    "Status",
  ]);
  const [row] = jobsToWorkbookRows([
    {
      company: "Acme",
      job_title: "Engineer",
      source_url: "https://example.com/jobs/1",
      created_at: "2026-08-24T12:00:00.000Z",
      review_status: "NEEDS_REVIEW",
      user_id: "123e4567-e89b-42d3-a456-426614174000",
      captured_by: { display_name: "Naira", email: "naira@example.com" },
    },
  ]);
  assert.equal(row[0], "Acme");
  assert.equal(row[1], "Engineer");
  assert.equal(row[2], "https://example.com/jobs/1");
  assert.equal(row[3], "Naira");
  assert.match(String(row[4]), /2026/);
  assert.equal(row[5], "Needs Review");
});

test("fetchAllFilteredJobs pages through every matching result", async () => {
  const calls = [];
  const list = async (_client, _base, filters) => {
    calls.push(filters);
    if (filters.page === 1) {
      return {
        items: [{ id: "1" }, { id: "2" }],
        total: 3,
        page: 1,
        pageSize: JOB_EXPORT_PAGE_SIZE,
        pageCount: 2,
      };
    }
    return {
      items: [{ id: "3" }],
      total: 3,
      page: 2,
      pageSize: JOB_EXPORT_PAGE_SIZE,
      pageCount: 2,
    };
  };
  const items = await fetchAllFilteredJobs({}, "https://api.example.com", { status: "ACTIVE" }, { list });
  assert.equal(items.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pageSize, JOB_EXPORT_PAGE_SIZE);
  assert.equal(calls[0].status, "ACTIVE");
  assert.equal(calls[1].page, 2);
});

test("fetchAllFilteredJobs rejects exports above the soft cap", async () => {
  const list = async () => ({
    items: [],
    total: JOB_EXPORT_MAX_ROWS + 1,
    page: 1,
    pageSize: JOB_EXPORT_PAGE_SIZE,
    pageCount: 1,
  });
  await assert.rejects(
    () => fetchAllFilteredJobs({}, "https://api.example.com", {}, { list }),
    (error) => error.code === "EXPORT_TOO_LARGE",
  );
});

test("Jobs page wires Download Excel to the export helper", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Download Excel/);
  assert.match(source, /exportFilteredJobsExcel/);
  assert.match(source, /from "\.\/services\/job-export-service\.js"/);
});
