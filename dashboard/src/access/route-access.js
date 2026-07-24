import {CAPABILITIES, hasCapability} from "./capabilities.js";

export const ROUTE_CAPABILITIES = Object.freeze({
  overview: null,
  profile: CAPABILITIES.PROFILE_VIEW_SELF,
  jobs: CAPABILITIES.BUSINESS_DATA_READ,
  "job-detail": CAPABILITIES.BUSINESS_DATA_READ,
  resumes: CAPABILITIES.BUSINESS_DATA_READ,
  "resume-detail": CAPABILITIES.BUSINESS_DATA_READ,
  "resume-upload": CAPABILITIES.USER_ADMIN,
  applications: CAPABILITIES.APPLICATION_VIEW,
  "application-detail": CAPABILITIES.APPLICATION_VIEW,
  "application-new": CAPABILITIES.APPLICATION_MANAGE,
  "users-directory": CAPABILITIES.USER_DIRECTORY_READ,
  "admin-users": CAPABILITIES.USER_ADMIN,
  "admin-user-detail": CAPABILITIES.USER_ADMIN,
  "admin-roles": CAPABILITIES.USER_ADMIN,
});

export const NAVIGATION = Object.freeze([
  {name: "overview", label: "Overview", href: "#/", capability: null},
  {name: "applications", label: "Applications", href: "#/applications", capability: CAPABILITIES.APPLICATION_VIEW},
  {name: "jobs", label: "Job Descriptions", href: "#/jobs", capability: CAPABILITIES.BUSINESS_DATA_READ},
  {name: "resumes", label: "Resumes", href: "#/resumes", capability: CAPABILITIES.BUSINESS_DATA_READ},
  {name: "resume-upload", label: "Upload Resume", href: "#/resumes/upload", capability: CAPABILITIES.USER_ADMIN},
  {name: "users-directory", label: "Users", href: "#/users", capability: CAPABILITIES.USER_DIRECTORY_READ},
  {name: "admin-users", label: "Users", href: "#/admin/users", capability: CAPABILITIES.USER_ADMIN},
  {name: "admin-roles", label: "Roles", href: "#/admin/roles", capability: CAPABILITIES.USER_ADMIN},
  {name: "profile", label: "My Profile", href: "#/profile", capability: CAPABILITIES.PROFILE_VIEW_SELF},
]);

export function navigationForAccess(access) {
  return NAVIGATION.filter(item => (!item.capability || hasCapability(access, item.capability)) && !(item.name === "users-directory" && hasCapability(access, CAPABILITIES.USER_ADMIN)));
}

export function guardAccessRoute(route, session, access) {
  if (!session && route.name !== "login") return "#/login";
  if (session && route.name === "login") return "#/";
  if (!session || !access) return null;
  if (access.status === "INACTIVE" && route.name !== "account-inactive") return "#/account-inactive";
  if (access.status === "ACTIVE" && access.roles.length === 0 && !["pending-access", "profile"].includes(route.name)) return "#/pending-access";
  if (["pending-access", "account-inactive"].includes(route.name)) return null;
  const required = ROUTE_CAPABILITIES[route.name];
  if (required && !hasCapability(access, required)) return "#/access-denied";
  return null;
}
