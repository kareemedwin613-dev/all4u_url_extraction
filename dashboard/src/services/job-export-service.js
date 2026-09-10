import { formatJobSubcategories } from "./category-service.js";
import { listJobs } from "./job-read-service.js";

export const JOB_EXPORT_PAGE_SIZE = 50;
export const JOB_EXPORT_MAX_ROWS = 5000;
export const JOB_EXPORT_HEADERS = Object.freeze([
  "Job ID",
  "Company Name",
  "Job Title",
  "Job Posting URL",
  "Subcategories",
]);

const HEADER_ALIASES = Object.freeze({
  "job id": "jobId",
  "id": "jobId",
  "job_description_id": "jobId",
  "company name": "company",
  "company": "company",
  "job title": "jobTitle",
  "role name": "jobTitle",
  "job posting url": "sourceUrl",
  "job description url": "sourceUrl",
  "url": "sourceUrl",
  "subcategories": "subcategories",
  "subcategory": "subcategories",
  "subcategory names": "subcategories",
});

export function formatSubcategoriesForExport(categories, job) {
  const text = formatJobSubcategories(categories, job);
  if (!text || text === "None") return "";
  return text.split(", ").map((part) => part.trim()).filter(Boolean).join("; ");
}

export function jobsToWorkbookRows(jobs = [], categories = null) {
  return (jobs || []).map((job) => [
    job?.id || "",
    job?.company || "",
    job?.job_title || "",
    job?.source_url || "",
    formatSubcategoriesForExport(categories, job),
  ]);
}

export async function fetchAllFilteredJobs(client, apiBaseUrl, filters = {}, { list = listJobs } = {}) {
  const first = await list(client, apiBaseUrl, {
    ...filters,
    page: 1,
    pageSize: JOB_EXPORT_PAGE_SIZE,
  });
  const total = Math.max(0, Number(first?.total) || 0);
  if (!total) return [];
  if (total > JOB_EXPORT_MAX_ROWS) {
    throw Object.assign(
      new Error(
        `Too many job descriptions to export (${total}). Narrow the filters to ${JOB_EXPORT_MAX_ROWS} or fewer.`,
      ),
      { code: "EXPORT_TOO_LARGE" },
    );
  }
  const items = [...(first.items || [])];
  const pageCount = Math.max(1, Number(first.pageCount) || Math.ceil(total / JOB_EXPORT_PAGE_SIZE));
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await list(client, apiBaseUrl, {
      ...filters,
      page,
      pageSize: JOB_EXPORT_PAGE_SIZE,
    });
    items.push(...(next.items || []));
  }
  return items.slice(0, total);
}

export async function downloadJobsExcel(rows, { filename, now = new Date() } = {}) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([JOB_EXPORT_HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Job Descriptions");
  const stamp = now.toISOString().slice(0, 10);
  const name = filename || `job-descriptions-${stamp}.xlsx`;
  XLSX.writeFile(workbook, name);
  return name;
}

export async function exportFilteredJobsExcel(client, apiBaseUrl, filters = {}, options = {}) {
  const jobs = await fetchAllFilteredJobs(client, apiBaseUrl, filters, options);
  if (!jobs.length) {
    throw Object.assign(new Error("No job descriptions match the current filters."), {
      code: "EXPORT_EMPTY",
    });
  }
  return downloadJobsExcel(jobsToWorkbookRows(jobs, options.categories));
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseJobSubcategoryImportRows(workbookMatrix = []) {
  const rows = Array.isArray(workbookMatrix) ? workbookMatrix : [];
  if (rows.length < 2) {
    throw Object.assign(new Error("The spreadsheet needs a header row and at least one data row."), {
      code: "IMPORT_EMPTY",
    });
  }
  const headers = (rows[0] || []).map(normalizeHeader);
  const index = {};
  headers.forEach((header, i) => {
    const key = HEADER_ALIASES[header];
    if (key && index[key] == null) index[key] = i;
  });
  if (index.jobId == null) {
    throw Object.assign(new Error('The spreadsheet must include a "Job ID" column.'), {
      code: "IMPORT_HEADERS",
    });
  }
  if (index.subcategories == null) {
    throw Object.assign(new Error('The spreadsheet must include a "Subcategories" column.'), {
      code: "IMPORT_HEADERS",
    });
  }
  const updates = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const jobId = String(row[index.jobId] ?? "").trim();
    if (!jobId) continue;
    updates.push({
      jobDescriptionId: jobId,
      subcategories: String(row[index.subcategories] ?? "").trim(),
    });
  }
  if (!updates.length) {
    throw Object.assign(new Error("No data rows with a Job ID were found."), {
      code: "IMPORT_EMPTY",
    });
  }
  if (updates.length > 2000) {
    throw Object.assign(new Error("Import at most 2000 rows at a time."), {
      code: "IMPORT_TOO_LARGE",
    });
  }
  return updates;
}

export async function readJobSubcategoryImportFile(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw Object.assign(new Error("The spreadsheet has no sheets."), { code: "IMPORT_EMPTY" });
  }
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });
  return parseJobSubcategoryImportRows(matrix);
}
