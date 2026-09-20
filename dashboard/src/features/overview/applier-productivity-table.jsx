import React, { useMemo } from "react";
import { useSavedFilters } from "../../shared/use-filter-preferences.js";
import { parseLocalSearchQuery } from "../../shared/filter-preferences.js";
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Table,
  Typography,
} from "antd";
import {
  MoreOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { UserAvatar } from "../../components/user-avatar.jsx";
import { tableRowNumberColumn } from "../../shared/table-sorting.js";
import { APPLIER_PERFORMANCE_METRICS } from "./applier-performance.js";
import {
  avgPerDayTone,
  formatApplierSalary,
  formatLastActivityMeta,
  gradeFromScore,
  normalizeApplierProductivity,
  sortProductivityRows,
  PRODUCTIVITY_STATUS,
  PRODUCTIVITY_TABLE_METRIC_KEYS,
  sumProductivityMetricTotals,
} from "./applier-productivity.js";

const DEFAULT_PRODUCTIVITY_SORT = Object.freeze({
  field: "applied",
  order: "descend",
});

function parseProductivityFilters(query = "") {
  const params = new URLSearchParams(query), fields = ["name", "salary", "avgPerDay", "lastActivityAt", ...PRODUCTIVITY_TABLE_METRIC_KEYS];
  return {
    ...parseLocalSearchQuery(query),
    field: fields.includes(params.get("field")) ? params.get("field") : DEFAULT_PRODUCTIVITY_SORT.field,
    order: ["ascend", "descend"].includes(params.get("order")) ? params.get("order") : DEFAULT_PRODUCTIVITY_SORT.order,
  };
}

const { Text } = Typography;

const productivityMetricsByKey = new Map(
  APPLIER_PERFORMANCE_METRICS.map((metric) => [metric.key, metric]),
);

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

function performanceCountColumn(metric, sortedInfo) {
  const wide = metric.key === "nonTailored" || metric.key === "tailored" || metric.key === "interviews" || metric.key === "interviewsTailored" || metric.key === "interviewsNonTailored";
  return {
    title: metric.label,
    dataIndex: metric.key,
    key: metric.key,
    width: wide ? 84 : 70,
    align: "center",
    className: `productivity-metric-col productivity-metric-col--${metric.key}`,
    sorter: true,
    sortOrder: sortedInfo.field === metric.key ? sortedInfo.order : null,
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

function ProductivityMetricTotal({ metricKey, value }) {
  return (
    <span
      className={`productivity-metric-value productivity-metric-value--${metricKey} productivity-metric-value--total${
        metricKey === "blocked" && value ? " productivity-metric-value--danger" : ""
      }`}
    >
      {value}
    </span>
  );
}

function ProductivityTableSummary({ totals, salaryTotal }) {
  const metricCount = PRODUCTIVITY_TABLE_METRIC_KEYS.length;
  return (
    <Table.Summary fixed>
      <Table.Summary.Row className="productivity-table-summary-row">
        <Table.Summary.Cell index={0} colSpan={2} />
        {PRODUCTIVITY_TABLE_METRIC_KEYS.map((key, index) => (
          <Table.Summary.Cell key={key} index={index + 2} align="center">
            <ProductivityMetricTotal metricKey={key} value={totals[key]} />
          </Table.Summary.Cell>
        ))}
        <Table.Summary.Cell index={2 + metricCount} align="center">
          <span className="productivity-metric-value productivity-metric-value--total">
            {formatApplierSalary(salaryTotal)}
          </span>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={3 + metricCount} colSpan={2} />
      </Table.Summary.Row>
    </Table.Summary>
  );
}

function buildColumns(windowDays, client, apiBaseUrl, page, pageSize, sortedInfo) {
  const sortOrder = (field) => (sortedInfo.field === field ? sortedInfo.order : null);

  return [
    tableRowNumberColumn({ page, pageSize }),
    {
      title: "Applier",
      dataIndex: "name",
      key: "name",
      width: 128,
      className: "productivity-applier-col",
      onHeaderCell: () => ({
        className: "productivity-applier-col",
        style: { textAlign: "center" },
      }),
      onCell: () => ({
        className: "productivity-applier-col",
        style: { textAlign: "left" },
      }),
      sorter: true,
      sortOrder: sortOrder("name"),
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
      title: "Applications",
      className: "productivity-group-col productivity-group-col--applications",
      sortable: false,
      align: "center",
      children: PRODUCTIVITY_TABLE_METRIC_KEYS.map((key) =>
        performanceCountColumn(productivityMetricsByKey.get(key), sortedInfo),
      ),
    },
    {
      title: "Salary",
      dataIndex: "salary",
      key: "salary",
      width: 96,
      align: "center",
      sorter: true,
      sortOrder: sortOrder("salary"),
      render: (value) => (
        <span className="productivity-metric-value productivity-metric-value--salary">
          {formatApplierSalary(value)}
        </span>
      ),
    },
    {
      title: "Avg / Day",
      dataIndex: "avgPerDay",
      key: "avgPerDay",
      width: 84,
      align: "center",
      sorter: true,
      sortOrder: sortOrder("avgPerDay"),
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
      key: "lastActivityAt",
      width: 104,
      align: "left",
      className: "productivity-activity-col",
      onHeaderCell: () => ({ className: "productivity-header-left" }),
      sorter: true,
      sortOrder: sortOrder("lastActivityAt"),
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
  ];
}

export function ApplierProductivityTable({
  rows = [],
  dateRange,
  windowDays,
  client,
  apiBaseUrl,
  dateLabel = "Today",
  showTitle = true,
  title = "Applier Productivity",
}) {
  const [filters, setFilters] = useSavedFilters("productivity-table", parseProductivityFilters);
  const search = filters.search, setSearch = search => setFilters(previous => ({ ...previous, search }));
  const sortedInfo = useMemo(() => ({ field: filters.field, order: filters.order }), [filters.field, filters.order]);
  const setSortedInfo = value => setFilters(previous => ({ ...previous, ...value }));
  const data = useMemo(
    () => normalizeApplierProductivity(rows, { dateRange }),
    [rows, dateRange],
  );
  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    const filtered = needle
      ? data.filter((item) =>
          `${item.name} ${item.email}`.toLocaleLowerCase().includes(needle),
        )
      : data;
    return sortProductivityRows(filtered, sortedInfo);
  }, [data, needle, sortedInfo]);
  const columns = useMemo(
    () =>
      buildColumns(
        windowDays || data[0]?.windowDays || 1,
        client,
        apiBaseUrl,
        1,
        Math.max(visible.length, 1),
        sortedInfo,
      ),
    [windowDays, data, client, apiBaseUrl, visible.length, sortedInfo],
  );
  const metricTotals = useMemo(() => sumProductivityMetricTotals(data), [data]);
  const salaryTotal = useMemo(
    () => data.reduce((sum, row) => sum + (Number(row.salary) || 0), 0),
    [data],
  );

  return (
    <div className="productivity-table-shell">
      <div className="productivity-table-header">
        <div className="productivity-table-header__top">
          {showTitle ? (
            <div className="productivity-table-tabs productivity-table-tabs--single">
              <span className="productivity-table-tabs__label">{title}</span>
            </div>
          ) : (
            <div />
          )}
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
            pagination={false}
            onChange={(_pagination, _filters, sorter) => {
              const next = Array.isArray(sorter) ? sorter[0] : sorter;
              if (next?.order) {
                setSortedInfo({
                  field: next.columnKey || next.field || DEFAULT_PRODUCTIVITY_SORT.field,
                  order: next.order,
                });
                return;
              }
              setSortedInfo(DEFAULT_PRODUCTIVITY_SORT);
            }}
            dataSource={visible}
            columns={columns}
            scroll={{ x: "max-content" }}
            summary={() => (
              <ProductivityTableSummary
                totals={metricTotals}
                salaryTotal={Math.round(salaryTotal * 100) / 100}
              />
            )}
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
        </div>
      ))}
    </div>
  );
}
