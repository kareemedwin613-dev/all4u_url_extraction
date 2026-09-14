import React, { useMemo } from "react";
import { BatchTimeEstimate } from "../../shared/batch-time-estimate.jsx";
import { useBatchTimeEstimate } from "../../shared/use-batch-time-estimate.js";
import { tailoringTimingItems } from "./tailoring-time.js";

export function TailoringTimeEstimate({ data, batchId, apiBaseUrl, stale }) {
  const items = useMemo(() => tailoringTimingItems(data?.items), [data?.items]);
  const estimate = useBatchTimeEstimate({
    scope: `${apiBaseUrl}|${batchId}`,
    items,
    updatedAt: data?.loadedAt,
    unavailable: stale || data?.batch?.id !== batchId,
    incomplete: Number(data?.batch?.selected_count) !== items.length,
    paused: data?.batch?.status === "PAUSED_RATE_LIMIT",
    cancelled: data?.batch?.status === "CANCELLED",
  });
  return <BatchTimeEstimate estimate={estimate} unit="resume"
    note="Timing covers generation and PDF creation. Follow-up score comparisons are not included in these recorded durations and may extend the batch." />;
}
