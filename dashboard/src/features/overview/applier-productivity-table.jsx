import React, { useMemo, useState } from "react";
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Table,
  Tabs,
  Typography,
} from "antd";
import {
  MoreOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { UserAvatar } from "../../components/user-avatar.jsx";
import { clientSortColumns, tableRowNumberColumn } from "../../shared/table-sorting.js";
import { APPLIER_PERFORMANCE_METRICS } from "./applier-performance.js";
import {
  activeDaysShare,
  avgPerDayTone,
  formatLastActivityMeta,
  gradeFromScore,
  normalizeApplierProductivity,
  PRODUCTIVITY_STATUS,
} from "./applier-productivity.js";

const { Text } = Typography;

const PRODUCTIVITY_TABLE_METRIC_KEYS = [
  "assigned",
  "completed",
  "applied",
  "blocked",
  "pending",
];

const productivityMetricsByKey = new Map(
  APPLIER_PERFORMANCE_METRICS.map((metric) => [metric.key, metric]),
);

const PRODUCTIVITY_TABLE_TABS = [
  { key: "productivity", label: "Applier Productivity" },
  { key: "activity", label: "Activity Summary", disabled: true },
  { key: "scorecard", label: "Performance Scorecard", disabled: true },
];

export function ProductivityStatusTag({ status }) {
  const meta = PRODUCTIVITY_STATUS[status] || PRODUCTIVITY_STATUS.INACTIVE;
  const label =
    status === PRODUCTIVITY_STATUS.LOW.key ? "Low Activity" : meta.label;
  return (
    <span
      className={`productivity-status-pill productivity-status-pill--${status.toLowerCase()}`}
    >
      <span
        className="productivity-status-pill__dot"
        style={{ background: meta.color }}
      />
      {label}
    </span>
  );
}

export function ProductivityScoreBadge({ score, tone, grade, showScore = false }) {
  const meta = grade ? { grade, tone: tone || gradeFromScore(score).tone } : gradeFromScore(score);
  return (
    <span
      className={`productivity-score productivity-score--${meta.tone}`}
      title={`Score ${score}${grade ? ` · Grade ${grade}` : ""}`}
    >
      {showScore ? score : meta.grade}
    </span>
  );
}

function performanceCountColumn(metric) {
  return {
    title: metric.label,
    dataIndex: metric.key,
    width: 76,
    align: "center",
    className: `productivity-metric-col productivity-metric-col--${metric.key}`,
    sorter: (left, right) => left[metric.key] - right[metric.key],
    render: (value) => (
      <span
        className={`productivity-metric-value productivity-metric-value--${metric.key}${
          metric.key === "blocked" && value ? " productivity-metric-value--danger" : ""
        }`}
      >
        {value}
      </span>
    ),
  };
}

function buildColumns(windowDays, client, apiBaseUrl, page, pageSize) {
  return clientSortColumns([
    tableRowNumberColumn({ page, pageSize }),
    {
      title: "Applier",
      dataIndex: "name",
      width: 140,
      className: "productivity-applier-col",
      onHeaderCell: () => ({
        className: "productivity-applier-col",
        style: { textAlign: "center" },
      }),
      onCell: () => ({
        className: "productivity-applier-col",
        style: { textAlign: "left" },
      }),
      sorter: (left, right) => left.name.localeCompare(right.name),
      render: (value, row) => (
        <div className="productivity-applier-cell">
          <UserAvatar
            client={client}
            apiBaseUrl={apiBaseUrl}
            userId={row.id}
            name={value}
            size={36}
          />
          <div className="productivity-applier-meta">
            <a
              href={`#/appliers/${row.id}`}
              className="productivity-applier-link"
              title={value}
            >
              {value}
            </a>
          </div>
        </div>
      ),
    },
    {
      title: "Status",
      dataIndex: "productivityStatus",
      width: 102,
      align: "left",
      className: "productivity-status-col",
      sorter: (left, right) =>
        left.productivityStatus.localeCompare(right.productivityStatus),
      render: (value) => <ProductivityStatusTag status={value} />,
    },
    {
      title: "Active Days",
      dataIndex: "activeDays",
      width: 110,
      align: "center",
      sorter: (left, right) => left.activeDays - right.activeDays,
      render: (value, row) => {
        const total = row.windowDays || windowDays;
        return (
          <div className="productivity-stack-cell">
            <span className="productivity-stack-cell__primary">
              {value} / {total}
            </span>
            <span className="productivity-stack-cell__secondary">
              {activeDaysShare(value, total)}%
            </span>
          </div>
        );
      },
    },
    {
      title: "Applications",
      className: "productivity-group-col productivity-group-col--applications",
      sortable: false,
      align: "center",
      children: PRODUCTIVITY_TABLE_METRIC_KEYS.map((key) =>
        performanceCountColumn(productivityMetricsByKey.get(key)),
      ),
    },
    {
      title: "Avg / Day",
      dataIndex: "avgPerDay",
      width: 96,
      align: "center",
      sorter: (left, right) => left.avgPerDay - right.avgPerDay,
      render: (value, row) => {
        const tone = avgPerDayTone(value, row.windowDays || windowDays);
        return (
          <span className={`productivity-pace productivity-pace--${tone}`}>
            {Number(value).toFixed(1)}
          </span>
        );
      },
    },
    {
      title: "Last Activity",
      dataIndex: "lastActivityAt",
      width: 118,
      align: "left",
      className: "productivity-activity-col",
      onHeaderCell: () => ({ className: "productivity-header-left" }),
      sorter: (left, right) =>
        new Date(left.lastActivityAt || 0).getTime() -
        new Date(right.lastActivityAt || 0).getTime(),
      render: (_, row) => {
        const meta = formatLastActivityMeta(row.lastActivityAt);
        return (
          <div className="productivity-stack-cell productivity-stack-cell--left">
            <span className="productivity-stack-cell__primary">{meta.primary}</span>
            <span className="productivity-stack-cell__meta">{meta.secondary}</span>
          </div>
        );
      },
    },
    {
      title: "Score",
      dataIndex: "score",
      width: 72,
      align: "center",
      className: "productivity-score-col",
      sorter: (left, right) => left.score - right.score,
      render: (value, row) => (
        <ProductivityScoreBadge
          score={row.score}
          tone={row.scoreTone}
          grade={row.grade}
          showScore
        />
      ),
    },
    {
      title: "",
      key: "actions",
      width: 44,
      align: "center",
      className: "productivity-actions-col",
      sortable: false,
      render: (_, row) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "detail",
                label: <a href={`#/appliers/${row.id}`}>View scorecard</a>,
              },
              {
                key: "applications",
                label: (
                  <a href={`#/applications?assignedTo=${encodeURIComponent(row.id)}`}>
                    View applications
                  </a>
                ),
              },
            ],
          }}
        >
          <Button
            type="text"
            size="small"
            className="productivity-row-action"
            icon={<MoreOutlined />}
            aria-label={`Actions for ${row.name}`}
          />
        </Dropdown>
      ),
    },
  ]);
}

export function ApplierProductivityTable({
  rows = [],
  dateRange,
  windowDays,
  client,
  apiBaseUrl,
  dateLabel = "Today",
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const data = useMemo(
    () => normalizeApplierProductivity(rows, { dateRange }),
    [rows, dateRange],
  );
  const columns = useMemo(
    () => buildColumns(windowDays || data[0]?.windowDays || 1, client, apiBaseUrl, page, pageSize),
    [windowDays, data, client, apiBaseUrl, page, pageSize],
  );
  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? data.filter((item) =>
            `${item.name} ${item.email}`.toLocaleLowerCase().includes(needle),
          )
        : data,
    [data, needle],
  );

  return (
    <div className="productivity-table-shell">
      <div className="productivity-table-header">
        <div className="productivity-table-header__top">
          <Tabs
            className="productivity-table-tabs"
            activeKey="productivity"
            items={PRODUCTIVITY_TABLE_TABS}
          />
          <Text type="secondary" className="productivity-table-period">
            {dateLabel}
          </Text>
        </div>
        <div className="productivity-table-tools">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search applier..."
            aria-label="Search Applier Productivity by name or email"
          />
        </div>
      </div>
      {!data.length ? (
        <Empty
          className="productivity-table-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No Appliers are available."
        />
      ) : !visible.length ? (
        <Empty
          className="productivity-table-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No Appliers match this search."
        />
      ) : (
        <div className="productivity-table-scroll">
          <Table
            className="productivity-table"
            rowKey="id"
            size="middle"
            tableLayout="fixed"
            pagination={{
              current: page,
              pageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 25, 50],
              showTotal: (total, range) =>
                `Showing ${range[0]} to ${range[1]} of ${total} applier${total === 1 ? "" : "s"}`,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              },
            }}
            dataSource={visible}
            columns={columns}
            scroll={{ x: "max-content" }}
          />
        </div>
      )}
    </div>
  );
}

export function ProductivityActivityDonut({ segments = [] }) {
  if (!segments.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No application activity in this period."
      />
    );
  }
  return null;
}

export function ProductivityNeedsAttention({ items = [], client, apiBaseUrl }) {
  if (!items.length) {
    return <Text type="secondary">All Appliers are on track for this period.</Text>;
  }
  return (
    <div className="productivity-attention-list">
      {items.map((item) => (
        <div key={item.id} className="productivity-attention-item">
          <UserAvatar
            client={client}
            apiBaseUrl={apiBaseUrl}
            userId={item.id}
            name={item.name}
            size={32}
          />
          <div className="productivity-attention-copy">
            <Button type="link" href={`#/appliers/${item.id}`} style={{ padding: 0, height: "auto" }}>
              <Text strong>{item.name}</Text>
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.reason}
            </Text>
          </div>
          <ProductivityStatusTag status={item.status} />
        </div>
      ))}
    </div>
  );
}

export function ProductivityLeaders({ items = [], client, apiBaseUrl }) {
  if (!items.length) {
    return <Text type="secondary">No productivity leaders yet.</Text>;
  }
  return (
    <div className="productivity-leaders-list">
      {items.map((item) => (
        <div key={item.id} className="productivity-leader-item">
          <span className="productivity-leader-rank">{item.rank}</span>
          <UserAvatar
            client={client}
            apiBaseUrl={apiBaseUrl}
            userId={item.id}
            name={item.name}
            size={32}
          />
          <div className="productivity-leader-copy">
            <Button type="link" href={`#/appliers/${item.id}`} style={{ padding: 0, height: "auto" }}>
              <Text strong>{item.name}</Text>
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.applied} apps · {item.avgPerDay.toFixed(1)} / day
            </Text>
          </div>
          <ProductivityScoreBadge score={item.score} showScore />
        </div>
      ))}
    </div>
  );
}
