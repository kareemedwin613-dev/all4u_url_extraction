import React from "react";
import { ClockCircleOutlined } from "@ant-design/icons";
import { OverviewKpiCard } from "./overview-ui.jsx";
import { interviewSchedulingTime } from "./interview-conversion.js";

export function InterviewSchedulingTimeCard({ counts }) {
  const timing = interviewSchedulingTime(counts);
  return <OverviewKpiCard
    tone="teal"
    icon={<ClockCircleOutlined />}
    label="Avg Days to Interview Scheduled"
    value={timing?.averageDays == null ? "—" : `${timing.averageDays.toFixed(1)} days`}
    meta={timing ? <>
      <div>{timing.sampleCount
        ? `Based on ${timing.sampleCount.toLocaleString()} application${timing.sampleCount === 1 ? "" : "s"}.`
        : "No applications with usable interview scheduling timestamps."}</div>
      <div>Applied in selected date range; first scheduling recorded.</div>
      {timing.excludedCount > 0 && <div>
        {timing.excludedCount.toLocaleString()} interviewed application{timing.excludedCount === 1 ? "" : "s"} excluded: missing or invalid timestamps.
      </div>}
    </> : "Interview scheduling time data unavailable."}
  />;
}
