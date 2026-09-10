import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  JOB_EXPORT_HEADERS,
  JOB_EXPORT_MAX_ROWS,
  JOB_EXPORT_PAGE_SIZE,
  fetchAllFilteredJobs,
  jobsToWorkbookRows,
  parseJobSubcategoryImportRows,
} from "../src/services/job-export-service.js";

test("job export workbook rows include Job ID and Subcategories", () => {
  assert.deepEqual(JOB_EXPORT_HEADERS, [
    "Job ID",
    "Company Name",
    "Job Title",
    "Job Posting URL",
    "Subcategories",
  ]);
  const categories = {
    byId: new Map([
      ["sub-1", { id: "sub-1", name: "Backend Engineering" }],
      ["sub-2", { id: "sub-2", name: "Python Engineering" }],
    ]),
  };
  const [row] = jobsToWorkbookRows(
    [
      {
        id: "b7653950-0156-48dc-a230-6450e0ac2048",
        company: "Acme",
        job_title: "Engineer",
        source_url: "https://example.com/jobs/1",
        subcategory_ids: ["sub-1", "sub-2"],
      },
    ],
    categories,
  );
  assert.equal(row[0], "b7653950-0156-48dc-a230-6450e0ac2048");
  assert.equal(row[1], "Acme");
  assert.equal(row[2], "Engineer");
  assert.equal(row[3], "https://example.com/jobs/1");
  assert.equal(row[4], "Backend Engineering; Python Engineering");
});

test("parseJobSubcategoryImportRows maps Job ID and Subcategories", () => {
  const updates = parseJobSubcategoryImportRows([
    ["Job ID", "Company Name", "Job Title", "Job Posting URL", "Subcategories"],
    [
      "b7653950-0156-48dc-a230-6450e0ac2048",
      "Acme",
      "Engineer",
      "https://example.com/jobs/1",
      "Backend Engineering; Python Engineering",
    ],
    ["", "Skip", "Me", "", ""],
  ]);
  assert.deepEqual(updates, [
    {
      jobDescriptionId: "b7653950-0156-48dc-a230-6450e0ac2048",
      subcategories: "Backend Engineering; Python Engineering",
    },
  ]);
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

test("Jobs page wires Download Excel and Upload Subcategories Excel", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /Download Excel/);
  assert.match(source, /Upload Subcategories Excel/);
  assert.match(source, /exportFilteredJobsExcel/);
  assert.match(source, /readJobSubcategoryImportFile/);
  assert.match(source, /importJobSubcategories/);
});
