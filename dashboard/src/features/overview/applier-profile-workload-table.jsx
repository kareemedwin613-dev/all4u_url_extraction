import React, { useMemo } from "react";
import { useSavedSearch } from "../../shared/use-filter-preferences.js";
import { useSavedTableSort } from "../../shared/use-saved-table-sort.js";
import { Button, Dropdown, Empty, Input, Table } from "antd";
import { MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { tableRowNumberColumn } from "../../shared/table-sorting.js";
import {
  APPLIER_PROFILE_WORKLOAD_METRICS,
  normalizeApplierProfileWorkload,
  PROFILE_TABLE_METRIC_KEYS,
  PROFILE_WORKLOAD_STATUS,
  sumProfileMetricTotals,
} from "./applier-profile-workload.js";

const profileMetricsByKey = new Map(
  APPLIER_PROFILE_WORKLOAD_METRICS.map((metric) => [metric.key, metric]),
);

export function ProfileWorkloadStatusTag({ status }) {
  const meta = PROFILE_WORKLOAD_STATUS[status] || PROFILE_WORKLOAD_STATUS.NO_ACTIVITY;
  return (
    <span
      className={`productivity-status-pill productivity-status-pill--${status.toLowerCase()}`}
    >
      <span
        className="productivity-status-pill__dot"
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}

function profileCountColumn(metric) {
  const wide =
    metric.key === "nonTailored" ||
    metric.key === "tailored" ||
    metric.key === "interviews" ||
    metric.key === "interviewsTailored" ||
    metric.key === "interviewsNonTailored";
  return {
    title: metric.label,
    dataIndex: metric.key,
    width: wide ? 84 : 70,
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

function ProfileMetricTotal({ metricKey, value }) {
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

function ProfileTableSummary({ totals, showApplier }) {
  const leadingCount = showApplier ? 4 : 3;
  const metricCount = PROFILE_TABLE_METRIC_KEYS.length;
  return (
    <Table.Summary fixed>
      <Table.Summary.Row className="productivity-table-summary-row">
        <Table.Summary.Cell index={0} colSpan={leadingCount} />
        {PROFILE_TABLE_METRIC_KEYS.map((key, index) => (
          <Table.Summary.Cell key={key} index={index + leadingCount} align="center">
            <ProfileMetricTotal metricKey={key} value={totals[key]} />
          </Table.Summary.Cell>
        ))}
        <Table.Summary.Cell index={leadingCount + metricCount} />
      </Table.Summary.Row>
    </Table.Summary>
  );
}

function buildColumns({ showApplier }) {
  return [
    tableRowNumberColumn({ page: 1, pageSize: 10000 }),
    {
      title: "Profile",
      dataIndex: "name",
      width: 160,
      className: "productivity-applier-col",
      sorter: (left, right) => left.name.localeCompare(right.name),
      render: (value, row) => (
        <div className="productivity-applier-meta">
          <a
            href={`#/resumes/${row.id}`}
            className="productivity-applier-link"
            title={value}
          >
            {value}
          </a>
        </div>
      ),
    },
    ...(showApplier
      ? [
          {
            title: "Applier",
            dataIndex: "applierName",
            width: 128,
            sorter: (left, right) => left.applierName.localeCompare(right.applierName),
            render: (value, row) =>
              row.applierUserId ? (
                <a href={`#/appliers/${row.applierUserId}`}>{value || "—"}</a>
              ) : (
                value || "—"
              ),
          },
        ]
      : []),
    {
      title: "Status",
      dataIndex: "status",
      width: 118,
      align: "left",
      className: "productivity-status-col",
      sorter: (left, right) => left.status.localeCompare(right.status),
      render: (value) => <ProfileWorkloadStatusTag status={value} />,
    },
    {
      title: "Applications",
      className: "productivity-group-col productivity-group-col--applications",
      sortable: false,
      align: "center",
      children: PROFILE_TABLE_METRIC_KEYS.map((key) =>
        profileCountColumn(profileMetricsByKey.get(key)),
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
                key: "resume",
                label: <a href={`#/resumes/${row.id}`}>View resume</a>,
              },
              {
                key: "applications",
                label: (
                  <a href={`#/applications?search=${encodeURIComponent(row.name)}`}>
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

export function ApplierProfileWorkloadTable({
  rows = [],
  dateLabel = "This period",
  showApplier = false,
  title = "My Active Profiles",
  showTitle = true,
}) {
  const [search, setSearch] = useSavedSearch("profile-workload-table");
  const data = useMemo(() => normalizeApplierProfileWorkload(rows), [rows]);
  const columns = useMemo(() => buildColumns({ showApplier }), [showApplier]);
  const savedTableSort = useSavedTableSort("profile-workload-table-sort", columns);
  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? data.filter((item) =>
            `${item.name} ${item.resumeName} ${item.applierName}`
              .toLocaleLowerCase()
              .includes(needle),
          )
        : data,
    [data, needle],
  );
  const metricTotals = useMemo(() => sumProfileMetricTotals(data), [data]);

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
          <span className="productivity-table-period">{dateLabel}</span>
        </div>
        <div className="productivity-table-tools">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search profile..."
            aria-label="Search profiles by name"
          />
        </div>
      </div>
      {!data.length ? (
        <Empty
          className="productivity-table-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No profiles are available."
        />
      ) : !visible.length ? (
        <Empty
          className="productivity-table-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No profiles match this search."
        />
      ) : (
        <div className="productivity-table-scroll">
          <Table
            className="productivity-table"
            rowKey={(row) => `${row.id}:${row.applierUserId || ""}`}
            size="middle"
            tableLayout="fixed"
            pagination={false}
            dataSource={visible}
            columns={savedTableSort.columns}
            onChange={(_pagination, _filters, sorter, extra) => {
              if (extra?.action === "sort") savedTableSort.onSort(sorter);
            }}
            scroll={{ x: "max-content" }}
            summary={() => (
              <ProfileTableSummary totals={metricTotals} showApplier={showApplier} />
            )}
          />
        </div>
      )}
    </div>
  );
}
