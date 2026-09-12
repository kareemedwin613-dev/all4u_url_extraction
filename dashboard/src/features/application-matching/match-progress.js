const scoringExclusions = new Set([
  "BELOW_THRESHOLD", "MATCH_NOT_ASSESSED", "MATCH_STALE", "MATCH_PENDING",
  "MATCH_PROCESSING", "MATCH_FAILED", "MATCH_INSUFFICIENT_DATA",
]);
const states = new Set(["NOT_ASSESSED", "STALE", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "INSUFFICIENT_DATA"]);

export function matchEvaluationState(row) {
  if (row.matchingMode === "CATEGORY" || (row.resumeType && row.resumeType !== "ORIGINAL") || row.existingApplicationId ||
      (row.exclusionCode && !scoringExclusions.has(row.exclusionCode))) return "SKIPPED";
  const state = row.matchStatus || row.exclusionCode?.replace(/^MATCH_/, "") || "NOT_ASSESSED";
  return states.has(state) ? state : "NOT_ASSESSED";
}

// Evaluation completion is not eligibility: a below-threshold score is still a
// successfully completed evaluation. Skipped pairs never inflate the denominator.
export function matchingProgress(rows = []) {
  const counts = { total: 0, completed: 0, processing: 0, queued: 0, notStarted: 0, failed: 0, insufficient: 0, skipped: 0, eligible: 0, belowThreshold: 0 };
  for (const row of rows) {
    const state = matchEvaluationState(row);
    if (state === "SKIPPED") { counts.skipped++; continue; }
    counts.total++;
    if (state === "COMPLETED") {
      counts.completed++;
      if (row.eligible) counts.eligible++;
      if (row.exclusionCode === "BELOW_THRESHOLD") counts.belowThreshold++;
    } else if (state === "PROCESSING") counts.processing++;
    else if (state === "PENDING") counts.queued++;
    else if (state === "FAILED") counts.failed++;
    else if (state === "INSUFFICIENT_DATA") counts.insufficient++;
    else counts.notStarted++;
  }
  const finished = counts.completed + counts.failed + counts.insufficient;
  const remaining = counts.total - finished;
  const status = !counts.total ? "EMPTY" : !remaining ? (counts.failed || counts.insufficient ? "FINISHED_WITH_ISSUES" : "COMPLETED")
    : counts.processing ? "PROCESSING" : counts.queued ? "QUEUED" : "NOT_STARTED";
  return { ...counts, finished, remaining, percent: counts.total ? Math.floor(100 * finished / counts.total) : 0, status };
}
