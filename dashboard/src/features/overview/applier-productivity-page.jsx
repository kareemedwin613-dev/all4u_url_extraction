import React, { useMemo } from "react";
import { Card, Typography } from "antd";
import {
  CheckCircleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  ApplierProductivityTable,
  ProductivityActivityDonut,
  ProductivityLeaders,
} from "./applier-productivity-table.jsx";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";
import {
  buildActivityOverviewSegments,
  getTopPerformers,
  normalizeApplierProductivity,
  overviewWindowDays,
  summarizeProductivityKpis,
} from "./applier-productivity.js";

const { Text } = Typography;

function ActivityDonutChart({ segments = [] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return <ProductivityActivityDonut segments={[]} />;
  }
  return (
    <div className="productivity-donut">
      <div className="productivity-donut__chart" style={{ width: 120, height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius={36}
              outerRadius={54}
              paddingAngle={2}
            >
              {segments.map((segment) => (
                <Cell key={segment.key} fill={segment.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="productivity-donut__center">
          <strong>{total}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="productivity-donut__legend">
        {segments.map((segment) => (
          <div key={segment.key} className="productivity-donut__legend-item">
            <span className="productivity-donut__legend-label">
              <span
                className="productivity-donut__swatch"
                style={{ background: segment.color }}
              />
              <span>{segment.label}</span>
            </span>
            <strong>
              {segment.value} ({Math.round((segment.value / total) * 1000) / 10}%)
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const activitySegments = useMemo(
    () => buildActivityOverviewSegments(applicationCounts),
    [applicationCounts],
  );

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
            <ActivityDonutChart segments={activitySegments} />
          </Card>
          <Card className="overview-chart-card productivity-side-card" title="Productivity Leaders">
            <ProductivityLeaders items={leaders} client={client} apiBaseUrl={apiBaseUrl} />
          </Card>
        </div>
      </div>
    </div>
  );
}
