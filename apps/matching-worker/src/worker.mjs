import { EXTRACTOR_VERSION, RUBRIC_VERSION, MatchingError, insufficientAssessment } from "./scoring.mjs";
import { DIRECT_SCORE_SCHEMA, directScoringInput, directScoringPrompt, normalizeDirectScore } from "./direct-scoring.mjs";
import { createStageLogger, matchingErrorFields } from "./logging.mjs";

export function createMatchingWorker({ rpc, provider, model, log = () => {}, heartbeatMs = 15_000 }) {
  const counts = { jobsStarted: 0, activeJobs: 0, completedCount: 0, insufficientCount: 0, staleCount: 0,
    failedAttemptCount: 0, modelCalls: 0 };
  let cooldownUntil = 0;
  async function runOne() {
    if (Date.now() < cooldownUntil) return false;
    const job = await rpc("claim_application_match", { p_model_id: model, p_rubric_version: RUBRIC_VERSION, p_extractor_version: EXTRACTOR_VERSION });
    if (!job) return false;
    const started = Date.now();
    const progress = createStageLogger(log, { id: job.id, attempt: job.attempt }, heartbeatMs);
    counts.jobsStarted++;
    counts.activeJobs++;
    let stage = "job.check";
    progress.emit("matching.job.started", { jdDocumentId: job.jdDocumentId, resumeDocumentId: job.resumeDocumentId });
    try {
      if (job.rubricVersion !== RUBRIC_VERSION || job.extractorVersion !== EXTRACTOR_VERSION) throw new MatchingError("WORKER_VERSION_MISMATCH");
      stage = "score.prepare";
      const prepared = await progress.run(stage, () => directScoringInput(job));
      let result;
      if (!prepared.sufficient) {
        progress.emit("matching.scoring.skipped", { reason: "MISSING_SOURCE_CONTENT" });
        result = insufficientAssessment("Substantive JD requirements and Resume experience are needed.");
      } else {
        stage = "score.generate";
        counts.modelCalls++;
        const output = await progress.run(stage, () => provider.generate({ name: "application_match", schema: DIRECT_SCORE_SCHEMA,
          instructions: directScoringPrompt(), input: prepared.input }));
        stage = "score.validate";
        result = await progress.run(stage, () => normalizeDirectScore(output));
      }
      stage = "score.save";
      const receipt = await progress.run(stage, () => rpc("complete_application_match", {
        p_id: job.id, p_lease_token: job.leaseToken, p_result: result }));
      const status = ["COMPLETED", "INSUFFICIENT_DATA", "STALE"].includes(receipt?.status) ? receipt.status : "UNKNOWN";
      if (status === "COMPLETED") counts.completedCount++;
      if (status === "INSUFFICIENT_DATA") counts.insufficientCount++;
      if (status === "STALE") counts.staleCount++;
      const score = status === "COMPLETED" && Number.isInteger(receipt.score) && receipt.score >= 1 && receipt.score <= 100 ? receipt.score : undefined;
      progress.emit("matching.completed", { status, score, durationMs: Date.now() - started });
    } catch (error) {
      counts.failedAttemptCount++;
      const details = matchingErrorFields(error), { code } = details;
      const failure = progress.failure || progress.current || { stage };
      // Invalid content needs review, not repeated model calls. Retry transient failures only.
      const retryable = code === "INVALID_MODEL_OUTPUT" ? false : error.retryable ?? true;
      const retryAfter = Math.min(900, (error.retryAfter || 30) * 2 ** Math.max(0, job.attempt - 1));
      if (code === "MODEL_RATE_LIMIT") cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfter * 1000);
      let failureRecorded = false;
      try {
        failureRecorded = await progress.run("failure.report", () => rpc("fail_application_match", {
          p_id: job.id, p_lease_token: job.leaseToken, p_code: code,
          p_retryable: retryable, p_retry_after: Math.ceil(retryAfter) })) === true;
      } catch { /* The stage log records a reporting failure; preserve the original failure below. */ }
      const retryScheduled = failureRecorded && retryable && job.attempt < 3;
      progress.emit("matching.failed", { ...failure, ...details, retryable, failureRecorded, retryScheduled,
        retryAfterSeconds: retryScheduled ? Math.ceil(retryAfter) : undefined, durationMs: Date.now() - started });
      if (error.stopWorker) throw error;
    } finally {
      counts.activeJobs--;
    }
    return true;
  }
  return { runOne, snapshot: () => ({ ...counts, cooldownRemainingMs: Math.max(0, cooldownUntil - Date.now()) }) };
}
