const number = (value: unknown) => Number(value || 0);

export const mapBatch = (row: any) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  creatorId: row.created_by,
  creatorName: row.creator_name || "Unknown user",
  selectedJdCount: number(row.selected_jd_count),
  requestedCount: number(row.requested_combination_count),
  createdCount: number(row.created_application_count),
  duplicateCount: number(row.duplicate_count),
  skippedCount: number(row.skipped_count),
  failedCount: number(row.failed_count),
  createdAt: row.created_at,
  completedAt: row.completed_at || null,
});

export const mapResult = (row: any) => ({
  id: row.id,
  key: row.key || row.pair_key,
  jobDescriptionId: row.jobDescriptionId || row.job_description_id || row.requested_job_description_id,
  resumeId: row.resumeId || row.resume_id || row.requested_resume_id,
  applicationId: row.applicationId || row.application_id || null,
  company: row.company || null,
  jobTitle: row.jobTitle || row.job_title || null,
  candidateName: row.candidateName || row.candidate_name || null,
  resumeName: row.resumeName || row.resume_name || null,
  outcome: row.outcome,
  errorCode: row.errorCode || row.code || null,
  message: row.message || "",
  ...(row.created_at ? { createdAt: row.created_at } : {}),
});

export const mapCreation = (value: any) => {
  if (!value || typeof value !== "object") {
    return {
      batchId: null,
      batchName: null,
      status: "FAILED",
      selectedJdCount: 0,
      requestedCount: 0,
      createdCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      failedCount: 0,
      replayed: false,
      results: [],
    };
  }
  return {
    batchId: value.batchId,
    batchName: value.batchName,
    status: value.status,
    selectedJdCount: number(value.selectedJdCount),
    requestedCount: number(value.requestedCount),
    createdCount: number(value.createdCount),
    duplicateCount: number(value.duplicateCount),
    skippedCount: number(value.skippedCount),
    failedCount: number(value.failedCount),
    replayed: Boolean(value.replayed),
    results: (value.results || []).map(mapResult),
  };
};
