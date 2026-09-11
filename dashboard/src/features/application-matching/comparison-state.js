export const COMPARISON_DIMENSIONS = [
  ["requiredSkills", "Required skills"], ["preferredSkills", "Preferred skills"],
  ["responsibilities", "Responsibilities"], ["seniority", "Seniority / scope"], ["domain", "Domain"],
];
export const comparisonPending = data => [data?.original, data?.tailored].some(value => ["PENDING", "PROCESSING"].includes(value?.status));
export const comparisonNeedsEvaluation = data => Boolean(data?.matchingConfigured && [data?.original, data?.tailored]
  .some(value => ["NOT_ASSESSED", "STALE", "FAILED", "PENDING", "PROCESSING"].includes(value?.status)));
export function comparisonDifference(data) {
  if (!data?.comparable || ![data.original, data.tailored].every(value => value?.status === "COMPLETED" && value.isCurrent
    && Number.isInteger(value.score))) return null;
  return data.tailored.score - data.original.score;
}
export function comparisonScoreLabel(value) {
  if (!value) return "Not tailored yet";
  if (Number.isInteger(value.score)) return `${value.score}/100${value.status === "STALE" ? " (outdated)" : ""}`;
  return ({ NOT_ASSESSED: "Not evaluated", PENDING: "Queued", PROCESSING: "Evaluating…", FAILED: "Evaluation failed",
    INSUFFICIENT_DATA: "Insufficient resume/JD content", STALE: "Needs reevaluation" })[value.status] || "Not available";
}
