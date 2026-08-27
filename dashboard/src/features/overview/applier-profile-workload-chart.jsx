import React, { useMemo, useState } from "react";
import { Card, Empty, Flex, Input, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
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
  APPLIER_PROFILE_WORKLOAD_METRICS,
  normalizeApplierProfileWorkload,
} from "./applier-profile-workload.js";

const { Text } = Typography;

export { APPLIER_PROFILE_WORKLOAD_METRICS, normalizeApplierProfileWorkload };

const shortName = (value, max = 14) => {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
};

function ProfileWorkloadTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="overview-chart-tooltip">
      <Text strong style={{ display: "block", marginBottom: 4 }}>
        {row.name}
      </Text>
      {row.resumeName && row.resumeName !== row.name ? (
        <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
          {row.resumeName}
        </Text>
      ) : null}
      {row.applierName ? (
        <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
          Applier: {row.applierName}
        </Text>
      ) : (
        <div style={{ marginBottom: 8 }} />
      )}
      {APPLIER_PROFILE_WORKLOAD_METRICS.map((metric) => (
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
    </div>
  );
}

export function ApplierProfileWorkloadChart({
  rows = [],
  dateLabel = "Today",
  title = "My Profile Workload",
  emptyDescription = "No Resume profiles are assigned to you yet.",
}) {
  const [search, setSearch] = useState(""),
    data = useMemo(() => normalizeApplierProfileWorkload(rows), [rows]),
    needle = search.trim().toLocaleLowerCase(),
    visible = useMemo(
      () =>
        needle
          ? data.filter((item) =>
              `${item.name} ${item.resumeName} ${item.applierName}`
                .toLocaleLowerCase()
                .includes(needle),
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
    <Card
      title={title}
      extra={<Text type="secondary">{dateLabel}</Text>}
      style={{ height: "100%" }}
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search profile, resume, or Applier"
        aria-label={`Search ${title} by profile, resume, or Applier`}
        style={{ marginBottom: 16 }}
      />
      {!data.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyDescription}
        />
      ) : !visible.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No profiles match this search."
        />
      ) : (
        <>
          <Flex gap={12} wrap="wrap" style={{ marginBottom: 12 }}>
            {APPLIER_PROFILE_WORKLOAD_METRICS.map((metric) => (
              <Flex key={metric.key} align="center" gap={6}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: metric.color,
                  }}
                />
                <Text>{metric.label}</Text>
              </Flex>
            ))}
          </Flex>
          <div
            className="overview-chart-scroll"
            role="img"
            aria-label="My Profile Workload Graph"
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
                    content={<ProfileWorkloadTooltip />}
                  />
                  {APPLIER_PROFILE_WORKLOAD_METRICS.map((metric) => (
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
    </Card>
  );
}
