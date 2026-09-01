import React, { useMemo, useState } from "react";
import { Empty, Typography } from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  JD_FINDER_PERFORMANCE_METRICS,
  normalizeJdFinderPerformance,
} from "./jd-finder-performance.js";
import { OverviewChartCard, OverviewChartLegend } from "./overview-ui.jsx";

const { Text } = Typography;

export { JD_FINDER_PERFORMANCE_METRICS, normalizeJdFinderPerformance };

const shortName = (value, max = 12) => {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
};

function JdFinderPerformanceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="overview-chart-tooltip">
      <Text strong style={{ display: "block", marginBottom: 8 }}>
        {row.name}
      </Text>
      {JD_FINDER_PERFORMANCE_METRICS.map((metric) => (
        <div key={metric.key} className="overview-chart-tooltip__row">
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: metric.color,
              flex: "none",
            }}
          />
          <Text style={{ flex: 1 }}>{metric.label}</Text>
          <Text strong>{row[metric.key]}</Text>
        </div>
      ))}
      <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
        {row.approvalRate}% approved
      </Text>
    </div>
  );
}

export function JdFinderPerformanceChart({ rows = [], dateLabel = "Today" }) {
  const [search, setSearch] = useState(""),
    data = useMemo(() => normalizeJdFinderPerformance(rows), [rows]),
    needle = search.trim().toLocaleLowerCase(),
    visible = useMemo(
      () =>
        needle
          ? data.filter((item) =>
              `${item.name} ${item.email}`.toLocaleLowerCase().includes(needle),
            )
          : data,
      [data, needle],
    ),
    chartData = useMemo(
      () =>
        visible.map((item) => ({
          ...item,
          axisLabel: shortName(item.name),
        })),
      [visible],
    ),
    chartMinWidth = Math.max(420, chartData.length * 96);

  return (
    <OverviewChartCard
      title="JD Finder Performance"
      extra={<Text type="secondary">{dateLabel}</Text>}
      search={search}
      onSearchChange={(event) => setSearch(event.target.value)}
      searchPlaceholder="Search JD Finder name or email"
      searchAriaLabel="Search JD Finder Performance by name or email"
    >
      {!data.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No active JD Finders are available."
        />
      ) : !visible.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No JD Finders match this search."
        />
      ) : (
        <>
          <OverviewChartLegend metrics={JD_FINDER_PERFORMANCE_METRICS} />
          <div
            className="overview-chart-scroll"
            role="img"
            aria-label="JD Finder Performance Graph"
          >
            <div style={{ minWidth: chartMinWidth, height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                  barCategoryGap="18%"
                  barGap={2}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="axisLabel"
                    interval={0}
                    tick={{ fontSize: 12 }}
                    tickMargin={8}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
                  <Tooltip
                    cursor={{ fill: "rgba(22, 119, 255, 0.06)" }}
                    content={<JdFinderPerformanceTooltip />}
                  />
                  {JD_FINDER_PERFORMANCE_METRICS.map((metric) => (
                    <Bar
                      key={metric.key}
                      dataKey={metric.key}
                      name={metric.label}
                      fill={metric.color}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </OverviewChartCard>
  );
}
