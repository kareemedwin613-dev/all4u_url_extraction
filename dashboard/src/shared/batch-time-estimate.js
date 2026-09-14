const MAX_SAMPLE_GAP_MS = 60_000;
const MAX_SAMPLES = 20;
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;

export function formatEstimatedDuration(milliseconds) {
  if (!positive(milliseconds)) return "—";
  if (milliseconds < 60_000) return `~${Math.max(5, Math.ceil(milliseconds / 5000) * 5)} sec`;
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes < 60 ? `~${minutes} min` : `~${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

// One tracker per selection/batch. No timers, network calls or browser storage.
// Initial completed scores are cached work, not observed runtime samples.
export function createBatchTimeTracker() {
  let previousAt = null, previous = new Map(), starts = new Map(), samples = new Map(), lastActivityAt = null, lastConcurrency = 0;
  return {
    observe(items, at, { unavailable = false, paused = false, cancelled = false, incomplete = false } = {}) {
      const result = (status, extra = {}) => ({ status, remainingMs: null, averageMs: null, sampleCount: samples.size, concurrency: 0, ...extra });
      if (unavailable || incomplete || paused) {
        // Don't turn a disconnected/paused interval into an item duration.
        previousAt = null; previous.clear(); starts.clear(); lastConcurrency = 0;
        return result(unavailable ? "UNAVAILABLE" : incomplete ? "INCOMPLETE" : "PAUSED");
      }
      if (cancelled) return result("CANCELLED");
      if (!positive(at)) return result("LEARNING");
      const current = new Map(items.map(item => [item.id, item]));
      for (const [key, sample] of samples) if (!current.has(sample.id)) samples.delete(key);
      const active = items.filter(item => item.status === "PROCESSING");
      const queued = items.filter(item => item.status === "QUEUED").length;
      const unstarted = items.filter(item => item.status === "NOT_STARTED").length;
      const remaining = active.length + queued + unstarted;
      if (!items.length) return result("EMPTY");

      if (at !== previousAt) {
        const gap = previousAt === null ? null : at - previousAt;
        const continuous = gap !== null && gap > 0 && gap <= MAX_SAMPLE_GAP_MS;
        if (!continuous) starts.clear();
        let activity = previousAt === null || !continuous || current.size !== previous.size;
        for (const item of items) {
          const before = previous.get(item.id);
          if (before?.status !== item.status || before?.attempt !== item.attempt) activity = true;
          if (before?.attempt !== item.attempt) starts.delete(item.id);
          if (item.status === "PROCESSING") {
            // Server timestamps survive navigation for tailoring. Scoring needs
            // a witnessed start; jobs already running when opened aren't timed.
            if (positive(item.startedAt) && item.startedAt <= at) starts.set(item.id, item.startedAt);
            else if (continuous && before && ["QUEUED", "NOT_STARTED"].includes(before.status)) starts.set(item.id, previousAt + gap / 2);
          } else if (item.status === "COMPLETED") {
            let duration = item.durationMs;
            if (!positive(duration) && continuous && before?.status !== "COMPLETED" && starts.has(item.id)) duration = at - starts.get(item.id);
            // A queued item which completes between polls took at most one poll interval.
            if (!positive(duration) && continuous && before?.status === "QUEUED" && before.attempt === item.attempt) duration = gap;
            if (positive(duration)) {
              const key = `${item.id}:${item.attempt ?? ""}`;
              if (!samples.has(key)) samples.set(key, { id: item.id, duration });
              while (samples.size > MAX_SAMPLES) samples.delete(samples.keys().next().value);
            }
            starts.delete(item.id);
          } else starts.delete(item.id);
        }
        for (const id of starts.keys()) if (!current.has(id)) starts.delete(id);
        if (activity) lastActivityAt = at;
        if (active.length) lastConcurrency = active.length;
        previousAt = at; previous = current;
      }
      const averageMs = samples.size ? [...samples.values()].reduce((sum, sample) => sum + sample.duration, 0) / samples.size : null;
      const basis = { averageMs, sampleCount: samples.size };
      if (!remaining) return result("DONE", basis);
      if (unstarted) return result("NOT_QUEUED", basis);
      if (!averageMs) return result(active.length ? "LEARNING" : "WAITING", basis);
      const slowAfter = Math.max(120_000, averageMs * 2);
      const longestActive = Math.max(0, ...active.map(item => starts.has(item.id) ? at - starts.get(item.id) : 0));
      if (at - lastActivityAt > slowAfter || longestActive > slowAfter) return result("SLOW", basis);
      if (!active.length && (!lastConcurrency || at - lastActivityAt > Math.max(30_000, averageMs))) return result("WAITING", basis);
      // Use observed parallelism, not a hardcoded worker setting. Running jobs
      // occupy slots; queued jobs are scheduled into the next available slot.
      const concurrency = active.length || lastConcurrency;
      const slots = Array.from({ length: concurrency }, (_, index) => {
        const item = active[index];
        if (!item) return 0;
        const elapsed = starts.has(item.id) ? Math.max(0, at - starts.get(item.id)) : 0;
        return Math.max(averageMs - elapsed, averageMs / 4);
      });
      for (let index = 0; index < queued; index++) {
        const next = slots.indexOf(Math.min(...slots));
        slots[next] += averageMs;
      }
      return result("READY", { ...basis, concurrency, remainingMs: Math.ceil(Math.max(...slots)) });
    },
  };
}
