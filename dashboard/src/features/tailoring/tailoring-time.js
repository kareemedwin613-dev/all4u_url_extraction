const timestamp = value => value ? Date.parse(value) : null;

export function tailoringTimingItems(items = []) {
  return items.map(item => ({
    id: item.id,
    attempt: item.attempt_count,
    status: ["PROCESSING", "MATERIALIZING"].includes(item.status) ? "PROCESSING"
      : ["PENDING", "WAITING_RETRY"].includes(item.status) ? "QUEUED"
        : ["COMPLETED", "NEEDS_REVIEW"].includes(item.status) ? "COMPLETED" : "SKIPPED",
    startedAt: timestamp(item.started_at),
    durationMs: item.duration_ms,
  }));
}
