export const EXTENSION_CAPABILITIES = Object.freeze({
  BUSINESS_READ: "BUSINESS_READ",
  BUSINESS_WRITE: "EXTENSION_BUSINESS_WRITE",
  RESUME_QUEUE_READ: "RESUME_QUEUE_READ",
  MY_APPLICATIONS_READ: "MY_APPLICATIONS_READ",
  TAILORING_CREATE: "TAILORING_CREATE",
  JD_REVIEW: "JD_REVIEW",
  JD_OWN_LIST: "JD_OWN_LIST",
});

const BUSINESS_READ_ROLES = new Set(["APPLIER", "APPLYING_MANAGER", "DEVELOPER", "DEVELOPMENT_MANAGER", "JD_FINDER", "ADMIN"]);
const BUSINESS_WRITE_ROLES = new Set(["APPLYING_MANAGER", "JD_FINDER", "ADMIN"]);
const RESUME_QUEUE_ROLES = new Set(["ADMIN"]);
const MY_APPLICATIONS_ROLES = new Set(["APPLIER"]);
const TAILORING_CREATE_ROLES = new Set(["APPLYING_MANAGER","ADMIN"]);
const JD_REVIEW_ROLES = new Set(["APPLYING_MANAGER","ADMIN"]);
const JD_OWN_LIST_ROLES = new Set(["JD_FINDER"]);

export function normalizeExtensionAccess(raw) {
  const source = Array.isArray(raw) ? raw[0] : raw;
  if (!source || typeof source !== "object") throw {code:"ACCESS_CONTEXT_FAILED",message:"Your access context could not be loaded."};
  const status = String(source.status || "").toUpperCase();
  if (!["ACTIVE","INACTIVE"].includes(status)) throw {code:"ACCESS_CONTEXT_FAILED",message:"Your access context is invalid."};
  const roles = [...new Set((Array.isArray(source.roles)?source.roles:[]).map(role=>String(role||"").trim().toUpperCase()).filter(Boolean))].sort();
  const capabilities = new Set();
  if (status === "ACTIVE") {
    if (roles.some(role=>BUSINESS_READ_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.BUSINESS_READ);
    if (roles.some(role=>BUSINESS_WRITE_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.BUSINESS_WRITE);
    if (roles.some(role=>RESUME_QUEUE_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.RESUME_QUEUE_READ);
    if (roles.some(role=>MY_APPLICATIONS_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.MY_APPLICATIONS_READ);
    if (roles.some(role=>TAILORING_CREATE_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.TAILORING_CREATE);
    if (roles.some(role=>JD_REVIEW_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.JD_REVIEW);
    if (roles.some(role=>JD_OWN_LIST_ROLES.has(role))) capabilities.add(EXTENSION_CAPABILITIES.JD_OWN_LIST);
  }
  return {userId:String(source.userId??source.user_id??""),email:String(source.email||"").toLowerCase(),fullName:String(source.fullName??source.full_name??""),status,roles,capabilities};
}

export const canReadBusiness=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.BUSINESS_READ)===true;
export const canWriteBusiness=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.BUSINESS_WRITE)===true;
export const canAccessResumeQueue=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.RESUME_QUEUE_READ)===true;
export const canAccessMyApplications=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.MY_APPLICATIONS_READ)===true;
export const canCreateTailoring=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.TAILORING_CREATE)===true;
export const canReviewJobs=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.JD_REVIEW)===true;
export const canListOwnJobs=access=>access?.capabilities?.has(EXTENSION_CAPABILITIES.JD_OWN_LIST)===true;

export function extensionAccessMessage(access) {
  if (!access) return "Your access context could not be loaded.";
  if (access.status === "INACTIVE") return "Your platform account is inactive.";
  if (!access.roles.length) return "Your account is waiting for an administrator to assign a role.";
  if (!canReadBusiness(access)) return "Your role does not allow access to business data in this extension.";
  if (!canWriteBusiness(access)) return "Your role allows read-only business access. Save and management actions are unavailable.";
  return "Business capture and resume-management access is enabled.";
}
