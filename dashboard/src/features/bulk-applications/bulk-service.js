import { authenticatedApiRequest } from "../../services/api-client.js";
import { paginationMeta } from "../../shared/pagination.js";
import { MAX_BULK_COMBINATIONS, MAX_BULK_JDS } from "./bulk-state.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages = {
  BULK_NO_JDS: "Select at least one job description.",
  BULK_LIMIT_EXCEEDED: "The bulk request exceeds the configured limit.",
  BULK_NO_COMBINATIONS: "Select at least one eligible combination.",
  NO_ELIGIBLE_COMBINATIONS: "Select at least one eligible combination.",
  IDEMPOTENCY_CONFLICT: "This retry key was already used for a different bulk request.",
  BATCH_NOT_FOUND: "The Application batch was not found.",
  BATCH_DELETE_INVALID: "Select at least one Application batch.",
  BATCH_STILL_PROCESSING: "This batch is still processing and cannot be deleted yet.",
  BATCH_HAS_ACTIVE_APPLICATIONS: "Cancel every Application in the batch before deleting it.",
  APPLICATION_ACCESS_DENIED: "Applying Manager or Admin access is required.",
  FORBIDDEN: "Applying Manager or Admin access is required.",
  UNAUTHORIZED: "Your session expired. Sign in again.",
  REQUEST_TIMEOUT: "The request timed out. Retry with the same key or check Batch History.",
};

export function normalizeBulkError(error, fallback = "The bulk Application request could not be completed.") {
  const raw = String(error?.message || ""), upper = raw.toUpperCase();
  const code = error?.code === "42501" ? "APPLICATION_ACCESS_DENIED" : messages[error?.code] ? error.code : /FETCH|NETWORK|TIMEOUT/.test(upper) ? "NETWORK_INTERRUPTION" : error?.code || "BULK_REQUEST_FAILED";
  return { code, message: code === "NETWORK_INTERRUPTION" ? "The network connection was interrupted. Check Batch History before retrying with the same request key." : messages[code] || raw || fallback, retryable: code === "NETWORK_INTERRUPTION" || code === "REQUEST_TIMEOUT" };
}

async function api(client, baseUrl, path, { method = "GET", body, idempotencyKey, timeoutMs } = {}) {
  try { const { payload } = await authenticatedApiRequest(client, { baseUrl, path, method, body, idempotencyKey, timeoutMs }); return payload; }
  catch (error) { throw normalizeBulkError(error); }
}

export async function previewBulkApplications(client, baseUrl, jobIds, resumeIds, matchingMode) {
  const ids = [...new Set((jobIds || []).filter((id) => UUID.test(String(id))))];
  if (!ids.length) throw normalizeBulkError({ code: "BULK_NO_JDS" });
  if (ids.length > MAX_BULK_JDS) throw normalizeBulkError({ code: "BULK_LIMIT_EXCEEDED" });
  // Preview errors must not inherit mutation-only advice about Batch History or retry keys.
  try {
    const { payload } = await authenticatedApiRequest(client, { baseUrl, path: "/api/v1/applications/bulk-preview", method: "POST",
      body: { jobDescriptionIds: ids, ...(resumeIds === undefined ? {} : { resumeIds }), ...(matchingMode ? { matchingMode } : {}) }, timeoutMs: 12_000 });
    return payload.data;
  } catch (error) {
    const code = error?.code || (/fetch|network|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || "")) ? "NETWORK_INTERRUPTION" : "PREVIEW_FAILED");
    throw { code, message: error?.message || "The matching preview could not be refreshed.",
      retryable: ["DATABASE_TIMEOUT", "DATABASE_UNAVAILABLE", "REQUEST_TIMEOUT", "API_TIMEOUT", "NETWORK_INTERRUPTION"].includes(code) };
  }
}

export async function requestApplicationMatches(client, baseUrl, combinations, retryFailed = false) {
  if (!Array.isArray(combinations) || !combinations.length || combinations.length > MAX_BULK_COMBINATIONS) throw new Error("Select 1 to 5000 JD/Resume pairs for scoring.");
  const pairs = combinations.map(pair => ({ jobDescriptionId: pair.jobDescriptionId || pair.job_description_id, resumeId: pair.resumeId || pair.resume_id }));
  return (await api(client, baseUrl, "/api/v1/application-matches", { method: "POST", body: { combinations: pairs, retryFailed }, timeoutMs: 20_000 })).data;
}

export async function revokeMatchingRunner(client, baseUrl, ticketId) {
  if (!UUID.test(ticketId || "")) throw new Error("Invalid scoring command ID.");
  return (await api(client, baseUrl, `/api/v1/application-matches/runner-tickets/${ticketId}/revoke`, { method: "POST", body: {} })).data;
}

export async function createBulkApplications(client, baseUrl, combinations, batchName = "", idempotencyKey = crypto.randomUUID(), matchingMode) {
  if (!Array.isArray(combinations) || !combinations.length) throw normalizeBulkError({ code: "BULK_NO_COMBINATIONS" });
  if (combinations.length > MAX_BULK_COMBINATIONS) throw normalizeBulkError({ code: "BULK_LIMIT_EXCEEDED" });
  if (String(batchName).trim().length > 120) throw normalizeBulkError(new Error("Batch name cannot exceed 120 characters."));
  const pairs = combinations.map((pair) => ({ jobDescriptionId: pair.jobDescriptionId || pair.job_description_id, resumeId: pair.resumeId || pair.resume_id }));
  return (await api(client, baseUrl, "/api/v1/applications/bulk-create", { method: "POST", body: { combinations: pairs, batchName: String(batchName).trim() || undefined, ...(matchingMode ? { matchingMode } : {}) }, idempotencyKey: `bulk_${idempotencyKey}`, timeoutMs: 32_000 })).data;
}

export async function listApplicationBatches(client, baseUrl, { search = "", status = "", sort = "created_desc", page = 1, pageSize = 25 } = {}) {
  const params = new URLSearchParams({ search: String(search).trim().slice(0, 100), status, sort, page: String(page), pageSize: String(pageSize) });
  const payload = await api(client, baseUrl, `/api/v1/application-batches?${params}`), data = payload.data;
  return data.pageCount === undefined ? { ...data, ...paginationMeta(data?.total, page, pageSize) } : data;
}
export const listApplicationBatchOptions = async (client, baseUrl) => (await api(client, baseUrl, "/api/v1/application-batches/options")).data;
export const getApplicationBatch = async (client, baseUrl, id) => (await api(client, baseUrl, `/api/v1/application-batches/${encodeURIComponent(id)}`)).data;
export async function listApplicationBatchResults(client, baseUrl, id, { page = 1, limit = 25, outcome = "", company = "", jobTitle = "", candidate = "", resume = "" } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), outcome, company, jobTitle, candidate, resume });
  return (await api(client, baseUrl, `/api/v1/application-batches/${encodeURIComponent(id)}/results?${params}`)).data;
}

export async function deleteApplicationBatches(client, baseUrl, { batchIds } = {}) {
  const ids = [...new Set((batchIds || []).filter((id) => UUID.test(String(id))))];
  if (!ids.length) throw normalizeBulkError({ code: "BATCH_DELETE_INVALID", message: "Select at least one Application batch." });
  if (ids.length > 100) throw normalizeBulkError({ code: "BATCH_DELETE_INVALID", message: "Select no more than 100 Application batches." });
  return (await api(client, baseUrl, "/api/v1/application-batches/bulk-delete", { method: "POST", body: { batchIds: ids }, timeoutMs: 32_000 })).data;
}
