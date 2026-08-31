export function activityLogActionColor(action = "") {
  const value = String(action).toUpperCase();
  if (value.includes("FAILED") || value.includes("BLOCKED")) return "error";
  if (value.includes("COMPLETED") || value.includes("SUBMITTED")) return "success";
  if (value.includes("ASSIGNED") || value.includes("STARTED")) return "processing";
  if (value.includes("SCREENSHOT") || value.includes("LOGIN")) return "gold";
  return "default";
}

export function formatActivityLogDetail(record = {}) {
  const detail = String(record.detail || "").trim();
  const company = String(record.company || "").trim();
  if (detail && company) return `${detail} · ${company}`;
  return detail || company || "";
}
