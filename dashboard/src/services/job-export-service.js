import * as XLSX from "xlsx";
import { formatDate, formatLabel } from "../shared/formatters.js";
import { personDisplayName } from "../shared/person-name.js";
import { listJobs } from "./job-read-service.js";

export const JOB_EXPORT_PAGE_SIZE = 50;
export const JOB_EXPORT_MAX_ROWS = 5000;
export const JOB_EXPORT_HEADERS = Object.freeze([
  "Company name",
  "Role name",
  "Job description URL",
  "Founded by",
  "Founded date",
  "Status",
]);

export function foundedBy(job) {
  return personDisplayName({
    displayName: job?.captured_by?.display_name,
    email: job?.captured_by?.email,
    userId: job?.user_id,
  });
}

export function jobsToWorkbookRows(jobs = []) {
  return (jobs || []).map((job) => [
    job?.company || "",
    job?.job_title || "",
    job?.source_url || "",
    foundedBy(job),
    formatDate(job?.created_at),
    formatLabel(job?.review_status),
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

export function downloadJobsExcel(rows, { filename, now = new Date() } = {}) {
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
  return downloadJobsExcel(jobsToWorkbookRows(jobs));
}
