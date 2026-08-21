import { personDisplayName } from "../../shared/person-name.js";

export const JD_FINDER_PERFORMANCE_METRICS = Object.freeze([
  { key: "captured", label: "Captured", color: "#8c8c8c" },
  { key: "approved", label: "Approved", color: "#52c41a" },
  { key: "needsReview", label: "Needs Review", color: "#faad14" },
  { key: "needsCorrection", label: "Correction", color: "#fa8c16" },
  { key: "declined", label: "Declined", color: "#ff4d4f" },
]);

const count = (value) => Math.max(0, Number(value) || 0);

export function normalizeJdFinderPerformance(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const email = String(row.email || "");
    return {
      id: String(row.id || ""),
      name: personDisplayName({
        fullName: row.finder_name || row.full_name,
        displayName: row.display_name,
        email,
        userId: row.id,
        fallback: "Unknown JD Finder",
      }),
      email,
      captured: count(row.captured_count),
      approved: count(row.approved_count),
      needsReview: count(row.needs_review_count),
      needsCorrection: count(row.needs_correction_count),
      declined: count(row.declined_count),
      approvalRate: Math.max(
        0,
        Math.min(100, Number(row.approval_rate) || 0),
      ),
    };
  });
}
