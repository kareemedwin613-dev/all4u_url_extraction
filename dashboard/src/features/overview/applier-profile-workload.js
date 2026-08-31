import { personDisplayName } from "../../shared/person-name.js";

export const APPLIER_PROFILE_WORKLOAD_METRICS = Object.freeze([
  { key: "assigned", label: "Assigned", color: "#8c8c8c" },
  { key: "applied", label: "Applied", color: "#722ed1" },
  { key: "blocked", label: "Blocked", color: "#ff4d4f" },
  { key: "pending", label: "Pending", color: "#1677ff" },
  { key: "interview", label: "Interviews", color: "#13c2c2" },
]);

export const PROFILE_WORKLOAD_STATUS = Object.freeze({
  ON_TRACK: { key: "ON_TRACK", label: "On track", color: "#52c41a" },
  IN_PROGRESS: { key: "IN_PROGRESS", label: "In progress", color: "#faad14" },
  NEEDS_ATTENTION: {
    key: "NEEDS_ATTENTION",
    label: "Needs attention",
    color: "#ff4d4f",
  },
  NO_ACTIVITY: { key: "NO_ACTIVITY", label: "No activity", color: "#bfbfbf" },
});

const count = (value) => Math.max(0, Number(value) || 0);

export function deriveProfileWorkloadStatus(row) {
  if (row.blocked > 0) {
    return PROFILE_WORKLOAD_STATUS.NEEDS_ATTENTION.key;
  }
  if (row.pending > 0) {
    return PROFILE_WORKLOAD_STATUS.IN_PROGRESS.key;
  }
  if (row.applied > 0 || row.interview > 0) {
    return PROFILE_WORKLOAD_STATUS.ON_TRACK.key;
  }
  if (row.assigned > 0) {
    return PROFILE_WORKLOAD_STATUS.IN_PROGRESS.key;
  }
  return PROFILE_WORKLOAD_STATUS.NO_ACTIVITY.key;
}

export function summarizeProfileWorkloadKpis(rows = []) {
  const totalProfiles = rows.length;
  const activeProfiles = rows.filter(
    (row) => row.status !== PROFILE_WORKLOAD_STATUS.NO_ACTIVITY.key,
  ).length;
  const applications = rows.reduce((sum, row) => sum + row.assigned, 0);
  const needsAttention = rows.filter(
    (row) => row.status === PROFILE_WORKLOAD_STATUS.NEEDS_ATTENTION.key,
  ).length;
  return { totalProfiles, activeProfiles, applications, needsAttention };
}

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
    const normalized = {
      id: String(row.id || ""),
      name: profileName,
      resumeName,
      applierName,
      assigned: count(row.assigned_count ?? row.total_count ?? row.assigned ?? row.total),
      applied: count(row.applied_count ?? row.applied),
      pending: count(row.pending_count ?? row.pending),
      blocked: count(row.blocked_count ?? row.blocked),
      interview: count(row.interview_count ?? row.interview),
    };
    return {
      ...normalized,
      status: deriveProfileWorkloadStatus(normalized),
    };
  });
}
