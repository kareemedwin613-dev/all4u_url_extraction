import {capabilitiesForRoles, normalizeRoleCodes} from "./capabilities.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAccessContext(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object") throw accessError("ACCESS_CONTEXT_FAILED", "Your access context could not be loaded.", true);
  const userId = String(raw.userId ?? raw.user_id ?? "");
  const status = String(raw.status || "").toUpperCase();
  if (!UUID.test(userId) || !["ACTIVE", "INACTIVE"].includes(status)) {
    throw accessError("ACCESS_CONTEXT_FAILED", "Your access context is invalid.", false);
  }
  const roles = normalizeRoleCodes(raw.roles ?? raw.role_codes);
  return {
    userId,
    email: String(raw.email || "").toLowerCase(),
    fullName: String(raw.fullName ?? raw.full_name ?? "").trim(),
    status,
    roles,
    capabilities: capabilitiesForRoles(roles, status),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
  };
}

export function accessState(access) {
  if (!access) return "ACCESS_ERROR";
  if (access.status === "INACTIVE") return "ACCOUNT_INACTIVE";
  if (!access.roles.length) return "PENDING_ACCESS";
  return "ACTIVE_WITH_ROLES";
}

export function accessError(code, message, retryable = false) {
  return {code, message, retryable};
}
