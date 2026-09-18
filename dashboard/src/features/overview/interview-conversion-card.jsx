import React from "react";
import { TeamOutlined } from "@ant-design/icons";
import { OverviewKpiCard } from "./overview-ui.jsx";
import { interviewConversion } from "./interview-conversion.js";

export function InterviewConversionCard({ counts }) {
  const conversion = interviewConversion(counts);
  return <OverviewKpiCard
    tone="indigo"
    icon={<TeamOutlined />}
    label="Interviews / Applied"
    value={conversion?.rate == null ? "—" : `${conversion.rate}%`}
    meta={conversion ? <>
      <div>{conversion.interviews.toLocaleString()} interviewed / {conversion.applied.toLocaleString()} applied</div>
      <div>{conversion.applied ? "Applied in selected date range; includes later interviews." : "No applications applied in the selected date range."}</div>
    </> : "Applied-date conversion data unavailable."}
  />;
}
