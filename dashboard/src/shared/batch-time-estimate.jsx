import React from "react";
import { Flex, Space, Statistic, Typography } from "antd";
import { formatEstimatedDuration } from "./batch-time-estimate.js";

const messages = {
  LEARNING: ["Estimating…", "Waiting for a successful timed completion. Jobs already in progress when this page opens may not provide a full timing sample."],
  WAITING: ["Waiting for processing", "Keep the terminal runner open. The estimate will update when processing is observed."],
  NOT_QUEUED: ["Not all work queued", "Queue the remaining candidates to estimate the whole selection."],
  PAUSED: ["Paused", "Time remaining will be recalculated after the retry/rate-limit pause."],
  SLOW: ["Recalculating…", "Progress is taking longer than the observed pace. Waiting for a new completion; check the terminal runner."],
  UNAVAILABLE: ["Temporarily unavailable", "A fresh progress update is needed before estimating time remaining."],
  INCOMPLETE: ["Partial data", "Load the complete selection to estimate time remaining."],
  DONE: ["Finished", "No queued or processing work remains. Failed items are not included unless retried."],
  CANCELLED: ["Cancelled", "No completion time is estimated for a cancelled batch."],
  EMPTY: ["—", "No candidates to estimate."],
};

export function BatchTimeEstimate({ estimate, unit = "candidate", note }) {
  const ready = estimate.status === "READY";
  const [label, description] = messages[estimate.status] || messages.LEARNING;
  return <Space direction="vertical" size="small" style={{ width: "100%" }}>
    <Flex gap={32} wrap>
      <Statistic title="Estimated time remaining" value={ready ? formatEstimatedDuration(estimate.remainingMs) : label} />
      {estimate.averageMs > 0 && <Statistic title={`Average per ${unit}`} value={formatEstimatedDuration(estimate.averageMs)} />}
    </Flex>
    <Typography.Text type="secondary">{ready
      ? `Based on ${estimate.sampleCount} successful timing sample(s) and ${estimate.concurrency} observed parallel job(s). Approximate; retries, slower jobs, and pauses can change this.`
      : description}</Typography.Text>
    {note && <Typography.Text type="secondary">{note}</Typography.Text>}
  </Space>;
}
