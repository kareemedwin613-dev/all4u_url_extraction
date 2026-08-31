export const APPLIER_STATUS_FILTER_OPTIONS = Object.freeze([
  { value: "", label: "All Statuses" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "APPLIED", label: "Applied" },
  { value: "BLOCKED", label: "Blocked" },
]);

export const APPLIER_STATUS_UPDATE_OPTIONS = Object.freeze([
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "APPLIED", label: "Applied" },
]);

export const APPLIER_VISIBLE_STATUSES = Object.freeze([
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "APPLIED",
]);
