import { personDisplayName } from "../../shared/person-name.js";

export const APPLIER_PROFILE_WORKLOAD_METRICS = Object.freeze([
  { key: "total", label: "Total", color: "#8c8c8c" },
  { key: "applied", label: "Applied", color: "#722ed1" },
  { key: "pending", label: "Pending", color: "#1677ff" },
  { key: "blocked", label: "Blocked", color: "#ff4d4f" },
  { key: "interview", label: "Interview", color: "#13c2c2" },
]);

const count = (value) => Math.max(0, Number(value) || 0);

export function normalizeApplierProfileWorkload(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const resumeName = String(row.resume_name || row.resumeName || "");
    const applierName = String(row.applier_name || row.applierName || "").trim();
    const profileName = personDisplayName({
      fullName: row.profile_name || row.profileName || row.candidate_name,
      displayName: row.candidate_name || row.candidateName,
      email: "",
      userId: row.id,
      fallback: resumeName || "Unnamed Profile",
    });
    return {
      id: String(row.id || ""),
      name: profileName,
      resumeName,
      applierName,
      total: count(row.total_count ?? row.total),
      applied: count(row.applied_count ?? row.applied),
      pending: count(row.pending_count ?? row.pending),
      blocked: count(row.blocked_count ?? row.blocked),
      interview: count(row.interview_count ?? row.interview),
    };
  });
}
