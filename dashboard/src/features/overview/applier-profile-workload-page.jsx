import React from "react";
import { Card } from "antd";
import { ActivityOverviewChart } from "./activity-overview-chart.jsx";
import { ApplierProfileWorkloadTable } from "./applier-profile-workload-table.jsx";
import { InterviewConversionCard } from "./interview-conversion-card.jsx";
import { InterviewSchedulingTimeCard } from "./interview-scheduling-time-card.jsx";

export function ApplierProfileWorkloadPage({
  rows = [],
  applicationCounts = {},
  dateLabel = "This period",
}) {
  return (
    <div className="productivity-page">
      <div className="productivity-layout">
        <Card
          className="overview-chart-card productivity-main-card"
          styles={{ body: { padding: 0 } }}
        >
          <ApplierProfileWorkloadTable rows={rows} dateLabel={dateLabel} />
        </Card>

        <div className="productivity-side-stack">
          <InterviewConversionCard counts={applicationCounts} />
          <InterviewSchedulingTimeCard counts={applicationCounts} />
          <Card className="overview-chart-card productivity-side-card" title="Activity Overview">
            <ActivityOverviewChart counts={applicationCounts} />
          </Card>
        </div>
      </div>
    </div>
  );
}
