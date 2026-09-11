import { MatchingError } from "./scoring.mjs";

const reasons = new Set(["INVALID_FIELD_TYPE", "TEXT_TOO_LONG", "TOO_MANY_ITEMS", "EMPTY_SOURCE_QUOTE",
  "SOURCE_QUOTE_MISMATCH", "TOO_MANY_FACTS", "INVALID_RATING_TYPE", "RATING_OUT_OF_RANGE",
  "JD_FACET_REQUIRES_NULL", "JD_FACET_REQUIRES_RATING", "INSUFFICIENT_REQUIRES_NULL", "NO_RATED_COMPONENTS",
  "MODEL_OUTPUT_MISSING", "MODEL_OUTPUT_READ_FAILED", "MODEL_OUTPUT_TOO_LARGE", "MODEL_OUTPUT_EMPTY",
  "MODEL_OUTPUT_NOT_JSON", "MODEL_OUTPUT_NOT_OBJECT", "API_RESPONSE_NOT_JSON", "API_RESPONSE_SHAPE_INVALID"]);
const types = new Set(["undefined", "null", "boolean", "number", "string", "array", "object", "integer_or_null"]);
const facet = "(?:requiredSkills|preferredSkills|responsibilities|seniority|domain)";
const fieldPath = new RegExp(`^(?:\\$|sufficient|summary|ratings|missingRequirements(?:\\[\\d{1,4}\\])?|components(?:\\.${facet}(?:\\.(?:rating|reason))?)?|${facet}(?:\\[\\d{1,4}\\](?:\\.(?:text|quote))?)?)$`);

export function matchingErrorFields(error) {
  const known = error instanceof MatchingError;
  const code = known && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : "MATCH_WORKER_ERROR";
  const fields = { code }, details = known ? error.diagnostics : undefined;
  if (!details || !reasons.has(details.reason)) return fields;
  fields.reason = details.reason;
  if (typeof details.field === "string" && fieldPath.test(details.field)) fields.field = details.field;
  for (const key of ["expectedType", "actualType"]) if (types.has(details[key])) fields[key] = details[key];
  for (const key of ["actualCount", "actualLength", "actualBytes", "limit"]) {
    if (Number.isSafeInteger(details[key]) && details[key] >= 0) fields[key] = details[key];
  }
  return fields;
}

// A broken log sink must never turn an already-saved score into a failed job.
export function emitMatchingLog(log, event) {
  try { log({ ...event, timestamp: new Date().toISOString() }); } catch { /* Logging is best effort. */ }
}

export function createStageLogger(log, context = {}, heartbeatMs = 15_000) {
  let failure, currentStage, stageStarted;
  const emit = (event, fields = {}) => emitMatchingLog(log, { event, ...context, ...fields });
  return {
    emit,
    get failure() { return failure; },
    get current() { return currentStage ? { stage: currentStage, stageDurationMs: Date.now() - stageStarted } : undefined; },
    async run(stage, operation) {
      const started = Date.now();
      currentStage = stage; stageStarted = started;
      emit("matching.stage.started", { stage });
      const timer = heartbeatMs > 0 ? setInterval(() => {
        emit("matching.stage.progress", { stage, durationMs: Date.now() - started });
      }, heartbeatMs) : null;
      timer?.unref?.();
      try {
        const result = await operation();
        emit("matching.stage.completed", { stage, durationMs: Date.now() - started });
        return result;
      } catch (error) {
        const currentFailure = { stage, stageDurationMs: Date.now() - started };
        failure ||= currentFailure; // Cleanup/reporting errors must not replace the original failed stage.
        emit("matching.stage.failed", { ...currentFailure, ...matchingErrorFields(error) });
        throw error;
      } finally {
        if (timer) clearInterval(timer);
      }
    },
  };
}
