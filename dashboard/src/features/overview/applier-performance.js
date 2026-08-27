import { personDisplayName } from "../../shared/person-name.js";

export const APPLIER_PERFORMANCE_METRICS = Object.freeze([
  { key: "assigned", label: "Assigned", color: "#8c8c8c" },
  { key: "pending", label: "Pending", color: "#1677ff" },
  { key: "blocked", label: "Blocked", color: "#ff4d4f" },
  { key: "completed", label: "Completed", color: "#52c41a" },
  { key: "applied", label: "Applied", color: "#722ed1" },
]);

const count = (value) => Math.max(0, Number(value) || 0);

export function normalizeApplierPerformance(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const email = String(row.email || "");
    return {
      id: String(row.id || ""),
      name: personDisplayName({
        fullName: row.applier_name || row.full_name,
        displayName: row.display_name,
        email,
        userId: row.id,
        fallback: "Unknown Applier",
      }),
      email,
      assigned: count(row.assigned_count),
      active: count(row.active_count),
      pending: count(row.pending_count ?? row.pending),
      blocked: count(row.blocked_count),
      completed: count(row.completed_count),
      applied: count(row.applied_count),
      completionRate: Math.max(
        0,
        Math.min(100, Number(row.completion_rate) || 0),
      ),
    };
  });
}
