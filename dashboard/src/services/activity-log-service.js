import { authenticatedApiRequest } from "./api-client.js";
import { normalizeAccessError } from "./admin-user-service.js";

const PAGE_SIZES = [25, 50, 100];
const ACTIONS = [
  "APPLICATION_SUBMITTED",
  "APPLICATION_BLOCKED",
  "APPLICATION_ASSIGNED",
  "APPLICATION_REASSIGNED",
  "APPLICATION_UNASSIGNED",
  "APPLICATION_STARTED",
  "APPLICATION_CANCELLED",
  "APPLICATION_CLOSED",
  "SCREENSHOT_UPLOADED",
  "EXTENSION_SESSION_STARTED",
  "EXTENSION_JOB_READY",
  "EXTENSION_AUTOFILL_COMPLETED",
  "EXTENSION_AUTOFILL_FAILED",
  "EXTENSION_SESSION_CANCELLED",
  "USER_LOGIN",
  "STATUS_CHANGED",
  "WORK_STATUS_CHANGED",
  "APPLICATION_STATUS_CHANGED",
];

export const ACTIVITY_LOG_ACTIONS = Object.freeze(ACTIONS);

export function normalizeActivityLogOptions(options = {}) {
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = PAGE_SIZES.includes(Number(options.pageSize))
    ? Number(options.pageSize)
    : 50;
  const search = String(options.search || "").trim().slice(0, 100);
  const action = ACTIONS.includes(String(options.action || "").toUpperCase())
    ? String(options.action).toUpperCase()
    : "";
  return {
    from: options.from || "",
    to: options.to || "",
    applierId: options.applierId || "",
    applicationId: options.applicationId || "",
    action,
    search,
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

function buildQuery(options) {
  const params = new URLSearchParams();
  params.set("from", options.from);
  params.set("to", options.to);
  if (options.applierId) params.set("applierId", options.applierId);
  if (options.applicationId) params.set("applicationId", options.applicationId);
  if (options.action) params.set("action", options.action);
  if (options.search) params.set("search", options.search);
  if (options.page > 1) params.set("page", String(options.page));
  if (options.pageSize !== 50) params.set("pageSize", String(options.pageSize));
  return params.toString();
}

async function api(client, baseUrl, path, { method = "GET", body } = {}) {
  try {
    const { payload } = await authenticatedApiRequest(client, {
      baseUrl,
      path,
      method,
      body,
    });
    return payload.data;
  } catch (error) {
    throw normalizeAccessError(error, "UNKNOWN_ERROR", "The activity log could not be loaded.");
  }
}

export async function listActivityLog(client, baseUrl, options = {}) {
  const normalized = normalizeActivityLogOptions(options);
  if (!normalized.from || !normalized.to) {
    throw normalizeAccessError(
      { code: "VALIDATION_ERROR", message: "A reporting period is required." },
      "VALIDATION_ERROR",
      "A reporting period is required.",
    );
  }
  const query = buildQuery(normalized);
  return api(client, baseUrl, `/api/v1/admin/activity-log?${query}`);
}
