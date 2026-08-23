const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
import {authenticatedApiRequest} from "./api-client.js";
const KNOWN_CODES = ["AUTH_REQUIRED", "ACCESS_CONTEXT_FAILED", "ACCOUNT_INACTIVE", "PENDING_ACCESS", "ACCESS_DENIED", "USER_NOT_FOUND", "ROLE_NOT_FOUND", "LAST_ACTIVE_ADMIN_REQUIRED", "VALIDATION_ERROR", "NETWORK_ERROR"];

export function normalizeAccessError(error, fallbackCode = "UNKNOWN_ERROR", fallbackMessage = "The request could not be completed.") {
  const raw = String(error?.message || "");
  const upper = raw.toUpperCase();
  const code = (KNOWN_CODES.includes(error?.code)?error.code:null) || KNOWN_CODES.find(value => upper.includes(value)) || (/JWT|AUTHENTICATED|401/.test(upper) ? "AUTH_REQUIRED" : /FETCH|NETWORK/.test(upper) ? "NETWORK_ERROR" : error?.code === "42501" ? "ACCESS_DENIED" : fallbackCode);
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
  const allowedSorts=["name_asc","name_desc","email_asc","email_desc","status_asc","status_desc","roles_asc","roles_desc","created_asc","created_desc"];
  const sort=allowedSorts.includes(String(options.sort||""))?String(options.sort):"name_asc";
  return {search, status, roleCode, sort, page, pageSize, offset: (page - 1) * pageSize};
}

async function api(client,baseUrl,path,{method="GET",body}={}){try{const{payload}=await authenticatedApiRequest(client,{baseUrl,path,method,body});return payload.data;}catch(error){throw normalizeAccessError(error);}}
export async function listUsers(client,baseUrl, options = {}) {
  const normalized = normalizeListOptions(options);
  const q=new URLSearchParams({search:normalized.search,sort:normalized.sort,page:String(normalized.page),pageSize:String(normalized.pageSize)});if(normalized.status)q.set("status",normalized.status);if(normalized.roleCode)q.set("roleCode",normalized.roleCode);return api(client,baseUrl,`/api/v1/admin/users?${q}`);
}

function requireUuid(id) {
  if (!UUID.test(String(id || ""))) throw {code: "VALIDATION_ERROR", message: "A valid user ID is required.", retryable: false};
  return id;
}

export async function getUser(client,baseUrl, id) {
  return api(client,baseUrl,`/api/v1/admin/users/${requireUuid(id)}`);
}

async function roleMutation(client,baseUrl, assign, userId, roleCode) {
  const code = String(roleCode || "").trim().toUpperCase();
  if (!code) throw {code: "VALIDATION_ERROR", message: "Select a system role.", retryable: false};
  const id=requireUuid(userId),data=assign?await api(client,baseUrl,`/api/v1/admin/users/${id}/roles`,{method:"POST",body:{roleCode:code}}):await api(client,baseUrl,`/api/v1/admin/users/${id}/roles/${code}`,{method:"DELETE"});return Array.isArray(data)?data:[];
}

export const assignRole = (client,baseUrl,userId,roleCode) => roleMutation(client,baseUrl,true,userId,roleCode);
export const removeRole = (client,baseUrl,userId,roleCode) => roleMutation(client,baseUrl,false,userId,roleCode);

export async function setStatus(client,baseUrl,userId, status) {
  const normalized = String(status || "").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(normalized)) throw {code: "VALIDATION_ERROR", message: "Select Active or Inactive.", retryable: false};
  return api(client,baseUrl,`/api/v1/admin/users/${requireUuid(userId)}/status`,{method:"PATCH",body:{status:normalized}});
}

export async function updateUserProfile(client, baseUrl, userId, fullName) {
  const name = String(fullName || "").trim();
  if (name.length > 200) throw {code: "VALIDATION_ERROR", message: "Full name must be at most 200 characters.", retryable: false};
  return api(client, baseUrl, `/api/v1/admin/users/${requireUuid(userId)}/profile`, {
    method: "PATCH",
    body: {fullName: name},
  });
}
