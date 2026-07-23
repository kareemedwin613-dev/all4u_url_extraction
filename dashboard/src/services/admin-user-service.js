const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_CODES = ["AUTH_REQUIRED", "ACCESS_CONTEXT_FAILED", "ACCOUNT_INACTIVE", "PENDING_ACCESS", "ACCESS_DENIED", "USER_NOT_FOUND", "ROLE_NOT_FOUND", "LAST_ACTIVE_ADMIN_REQUIRED", "VALIDATION_ERROR", "NETWORK_ERROR"];

export function normalizeAccessError(error, fallbackCode = "UNKNOWN_ERROR", fallbackMessage = "The request could not be completed.") {
  const raw = String(error?.message || "");
  const upper = raw.toUpperCase();
  const code = KNOWN_CODES.find(value => upper.includes(value)) || (/JWT|AUTHENTICATED|401/.test(upper) ? "AUTH_REQUIRED" : /FETCH|NETWORK/.test(upper) ? "NETWORK_ERROR" : error?.code === "42501" ? "ACCESS_DENIED" : fallbackCode);
  const messages = {
    AUTH_REQUIRED: "Your session expired. Please sign in again.",
    ACCESS_DENIED: "You do not have permission to perform this action.",
    USER_NOT_FOUND: "The selected user no longer exists.",
    ROLE_NOT_FOUND: "The selected system role does not exist.",
    LAST_ACTIVE_ADMIN_REQUIRED: "At least one active Admin must remain.",
    VALIDATION_ERROR: "Review the supplied values and try again.",
    NETWORK_ERROR: "A network error prevented the request.",
    ACCESS_CONTEXT_FAILED: "Your access context could not be loaded.",
  };
  return {code, message: messages[code] || fallbackMessage, retryable: ["NETWORK_ERROR", "UNKNOWN_ERROR", "ACCESS_CONTEXT_FAILED"].includes(code)};
}

export function normalizeListOptions(options = {}) {
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = [25, 50, 100].includes(Number(options.pageSize)) ? Number(options.pageSize) : 25;
  const status = ["ACTIVE", "INACTIVE"].includes(String(options.status || "").toUpperCase()) ? String(options.status).toUpperCase() : null;
  const roleCode = String(options.roleCode || "").trim().toUpperCase() || null;
  const search = String(options.search || "").trim().slice(0, 100);
  return {search, status, roleCode, page, pageSize, offset: (page - 1) * pageSize};
}

export async function listUsers(client, options = {}) {
  const normalized = normalizeListOptions(options);
  const {data, error} = await client.rpc("admin_list_users", {
    p_search: normalized.search,
    p_status: normalized.status,
    p_role_code: normalized.roleCode,
    p_limit: normalized.pageSize,
    p_offset: normalized.offset,
  });
  if (error) throw normalizeAccessError(error);
  const items = data || [];
  const total = Number(items[0]?.total_count || 0);
  return {items, page: normalized.page, pageSize: normalized.pageSize, total, totalPages: Math.ceil(total / normalized.pageSize)};
}

function requireUuid(id) {
  if (!UUID.test(String(id || ""))) throw {code: "VALIDATION_ERROR", message: "A valid user ID is required.", retryable: false};
  return id;
}

export async function getUser(client, id) {
  const {data, error} = await client.rpc("admin_get_user", {p_user_id: requireUuid(id)});
  if (error) throw normalizeAccessError(error);
  return data;
}

async function roleMutation(client, name, userId, roleCode) {
  const code = String(roleCode || "").trim().toUpperCase();
  if (!code) throw {code: "VALIDATION_ERROR", message: "Select a system role.", retryable: false};
  const {data, error} = await client.rpc(name, {p_user_id: requireUuid(userId), p_role_code: code});
  if (error) throw normalizeAccessError(error);
  return Array.isArray(data) ? data : [];
}

export const assignRole = (client, userId, roleCode) => roleMutation(client, "admin_assign_role", userId, roleCode);
export const removeRole = (client, userId, roleCode) => roleMutation(client, "admin_remove_role", userId, roleCode);

export async function setStatus(client, userId, status) {
  const normalized = String(status || "").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(normalized)) throw {code: "VALIDATION_ERROR", message: "Select Active or Inactive.", retryable: false};
  const {data, error} = await client.rpc("admin_set_user_status", {p_user_id: requireUuid(userId), p_status: normalized});
  if (error) throw normalizeAccessError(error);
  return data;
}
