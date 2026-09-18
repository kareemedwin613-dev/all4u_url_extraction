// Never derive this rate from the activity/status counts: their date basis differs.
export function interviewConversion(counts = {}) {
  const cohort = counts?.applied_cohort;
  if (!cohort) return null;
  const { applied_count: applied, interviewed_count: interviews } = cohort;
  if (!Number.isSafeInteger(applied) || !Number.isSafeInteger(interviews)
    || applied < 0 || interviews < 0 || interviews > applied) return null;
  return { applied, interviews, rate: applied ? Math.round(1000 * interviews / applied) / 10 : null };
}
