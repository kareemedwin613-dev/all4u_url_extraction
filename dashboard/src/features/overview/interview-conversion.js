// Never derive this rate from the activity/status counts: their date basis differs.
export function interviewConversion(counts = {}) {
  const cohort = counts?.applied_cohort;
  if (!cohort) return null;
  const { applied_count: applied, interviewed_count: interviews } = cohort;
  if (!Number.isSafeInteger(applied) || !Number.isSafeInteger(interviews)
    || applied < 0 || interviews < 0 || interviews > applied) return null;
  return { applied, interviews, rate: applied ? Math.round(1000 * interviews / applied) / 10 : null };
}

// Only the server can aggregate complete history across the applied-date cohort.
export function interviewSchedulingTime(counts = {}) {
  const conversion = interviewConversion(counts), cohort = counts?.applied_cohort;
  if (!conversion) return null;
  const sampleCount = cohort.interview_scheduling_sample_count;
  const averageDays = cohort.avg_days_to_interview_scheduled;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > conversion.interviews) return null;
  if (sampleCount === 0 ? averageDays !== null : typeof averageDays !== "number" || !Number.isFinite(averageDays) || averageDays < 0) return null;
  return { sampleCount, averageDays, excludedCount: conversion.interviews - sampleCount };
}
