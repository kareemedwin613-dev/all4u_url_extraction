import { useEffect, useRef, useState } from "react";
import { createBatchTimeTracker } from "./batch-time-estimate.js";

export function useBatchTimeEstimate({ scope, items, updatedAt, unavailable = false, paused = false, cancelled = false, incomplete = false }) {
  const tracker = useRef(null), [value, setValue] = useState(null);
  useEffect(() => {
    if (tracker.current?.scope !== scope) tracker.current = { scope, engine: createBatchTimeTracker() };
    const estimate = tracker.current.engine.observe(items, updatedAt, { unavailable, paused, cancelled, incomplete });
    setValue({ scope, updatedAt, estimate });
  }, [scope, items, updatedAt, unavailable, paused, cancelled, incomplete]);
  // Never flash the previous selection's ETA while a new response is loading.
  if (unavailable || incomplete || paused || cancelled) return { status: unavailable ? "UNAVAILABLE" : incomplete ? "INCOMPLETE" : paused ? "PAUSED" : "CANCELLED" };
  return value?.scope === scope && value.updatedAt === updatedAt ? value.estimate : { status: "LEARNING" };
}
