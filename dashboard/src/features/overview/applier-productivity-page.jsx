import React, { useMemo } from "react";
import { Card, Typography } from "antd";
import {
  CheckCircleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ActivityOverviewChart } from "./activity-overview-chart.jsx";
import {
  ApplierProductivityTable,
  ProductivityLeaders,
} from "./applier-productivity-table.jsx";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";
import {
  getTopPerformers,
  normalizeApplierProductivity,
  overviewWindowDays,
  summarizeProductivityKpis,
} from "./applier-productivity.js";

const { Text } = Typography;

export function ApplierProductivityPage({
  client,
  apiBaseUrl,
  rows = [],
  applicationCounts = {},
  dateLabel = "Today",
  dateRange,
}) {
  const data = useMemo(
    () => normalizeApplierProductivity(rows, { dateRange }),
    [rows, dateRange],
  );
  const windowDays = overviewWindowDays(dateRange);
  const kpis = useMemo(
    () =>
      summarizeProductivityKpis(data, {
        windowDays,
        appliedTotal: applicationCounts.applied_today,
      }),
    [data, windowDays, applicationCounts.applied_today],
  );
  const leaders = useMemo(() => getTopPerformers(data), [data]);

  return (
    <div className="productivity-page">
      <OverviewSection
        title="Applier Productivity"
        description={`Track how Appliers are working in ${dateLabel.toLowerCase()}. Applications use apply dates; assigned and completed use applications created in this period.`}
      >
        <OverviewKpiGrid columns={5}>
          {[
            {
              key: "total",
              tone: "blue",
              icon: <TeamOutlined />,
              value: kpis.totalAppliers,
              label: "Total Appliers",
              meta: "All Applier accounts",
            },
            {
              key: "active",
              tone: "green",
              icon: <CheckCircleOutlined />,
              value: kpis.activeAppliers,
              label: "Active Appliers",
              meta: `${kpis.activeShare}% productive in period`,
            },
            {
              key: "applications",
              tone: "purple",
              icon: <ThunderboltOutlined />,
              value: kpis.applications,
              label: "Applications",
              meta: "Submitted in this period",
            },
            {
              key: "avg",
              tone: "orange",
              icon: <TrophyOutlined />,
              value: kpis.avgPerDay.toFixed(1),
              label: "Avg Applications / Day",
              meta: "Team-wide apply pace",
            },
            {
              key: "success",
              tone: "teal",
              icon: <UserOutlined />,
              value: `${kpis.avgSuccessRate}%`,
              label: "Avg Success Rate",
              meta: "Completion across Appliers",
            },
          ].map((card) => (
            <OverviewKpiCard key={card.key} {...card} />
          ))}
        </OverviewKpiGrid>
      </OverviewSection>

      <div className="productivity-layout">
        <Card
          className="overview-chart-card productivity-main-card"
          styles={{ body: { padding: 0 } }}
        >
          <ApplierProductivityTable
            client={client}
            apiBaseUrl={apiBaseUrl}
            rows={rows}
            dateRange={dateRange}
            windowDays={kpis.windowDays}
            dateLabel={dateLabel}
          />
        </Card>

        <div className="productivity-side-stack">
          <Card className="overview-chart-card productivity-side-card" title="Activity Overview">
            <ActivityOverviewChart counts={applicationCounts} />
          </Card>
          <Card className="overview-chart-card productivity-side-card" title="Productivity Leaders">
            <ProductivityLeaders items={leaders} client={client} apiBaseUrl={apiBaseUrl} />
          </Card>
        </div>
      </div>
    </div>
  );
}
