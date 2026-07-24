import {isUuid} from "./shared/validation.js";

export function parseRoute(hash = "#/") {
  const raw = String(hash || "#/").replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return {name: "overview", path: "/", query};
  if (parts[0] === "login" && parts.length === 1) return {name: "login", path: "/login", query};
  if (parts[0] === "profile" && parts.length === 1) return {name: "profile", path: "/profile", query};
  if (parts[0] === "pending-access" && parts.length === 1) return {name: "pending-access", path: "/pending-access", query};
  if (parts[0] === "account-inactive" && parts.length === 1) return {name: "account-inactive", path: "/account-inactive", query};
  if (parts[0] === "access-denied" && parts.length === 1) return {name: "access-denied", path: "/access-denied", query};
  if (parts[0] === "applications" && parts.length === 1) return {name: "applications", path: "/applications", query};
  if (parts[0] === "applications" && parts[1] === "bulk-create" && parts.length === 2) return {name: "application-bulk-create", path: "/applications/bulk-create", query};
  if (parts[0] === "applications" && parts[1] === "new" && parts.length === 2) return {name: "application-new", path: "/applications/new", query};
  if (parts[0] === "applications" && parts.length === 2) return isUuid(parts[1]) ? {name: "application-detail", path, id: parts[1], query} : {name: "invalid-id", path, query};
  if (parts[0] === "application-batches" && parts.length === 1) return {name: "application-batches", path: "/application-batches", query};
  if (parts[0] === "application-batches" && parts.length === 2) return isUuid(parts[1]) ? {name: "application-batch-detail", path, id: parts[1], query} : {name: "invalid-id", path, query};
  if (parts[0] === "users" && parts.length === 1) return {name: "users-directory", path: "/users", query};
  if (parts[0] === "jobs" && parts.length === 1) return {name: "jobs", path: "/jobs", query};
  if (parts[0] === "jobs" && parts.length === 2) return isUuid(parts[1]) ? {name: "job-detail", path, id: parts[1], query} : {name: "invalid-id", path, query};
  if (parts[0] === "resumes" && parts.length === 1) return {name: "resumes", path: "/resumes", query};
  if (parts[0] === "resumes" && parts[1] === "upload" && parts.length === 2) return {name: "resume-upload", path: "/resumes/upload", query};
  if (parts[0] === "resumes" && parts.length === 2) return isUuid(parts[1]) ? {name: "resume-detail", path, id: parts[1], query} : {name: "invalid-id", path, query};
  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 2) return {name: "admin-users", path: "/admin/users", query};
  if (parts[0] === "admin" && parts[1] === "users" && parts.length === 3) return isUuid(parts[2]) ? {name: "admin-user-detail", path, id: parts[2], query} : {name: "invalid-id", path, query};
  if (parts[0] === "admin" && parts[1] === "roles" && parts.length === 2) return {name: "admin-roles", path: "/admin/roles", query};
  return {name: "not-found", path, query};
}

export function guardRoute(route, session) {
  if (!session && route.name !== "login") return "#/login";
  if (session && route.name === "login") return "#/";
  return null;
}

export const navigate = (path, {replace = false} = {}) => replace ? location.replace(path) : location.assign(path);
