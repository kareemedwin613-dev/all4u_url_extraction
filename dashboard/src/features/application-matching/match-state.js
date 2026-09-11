export const MATCHING_MODES = [
  { value: "SCORE", label: "AI score — 70+ required" },
  { value: "CATEGORY", label: "Category/subcategory — no AI evaluation" },
];
export const categoryMatchingDescription = "Create without AI evaluation using the previous rules: a shared primary category, plus a matching subcategory for Software Engineering when the JD specifies one. Other categories use primary-only matching.";
export const canRequestMatch = row => row?.matchingMode !== "CATEGORY" && ["MATCH_NOT_ASSESSED", "MATCH_STALE", "MATCH_FAILED"].includes(row?.exclusionCode);
export const canRunMatch = row => row?.matchingMode !== "CATEGORY" && (canRequestMatch(row) || ["MATCH_PENDING", "MATCH_PROCESSING"].includes(row?.exclusionCode));
export const hasPendingMatches = rows => rows.some(row => row.matchingMode !== "CATEGORY" && ["PENDING", "PROCESSING"].includes(row.matchStatus));
export function reconcileMatchSelection(previousRows, nextRows, current) {
  const previouslyEligible = new Set(previousRows.filter(row => row.eligible).map(row => row.key));
  return new Set(nextRows.filter(row => row.eligible && !row.existingApplicationId
    && (current.has(row.key) || !previouslyEligible.has(row.key))).map(row => row.key));
}
