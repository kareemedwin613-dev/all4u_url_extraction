import React, { useMemo, useState } from "react";
import { Button, Dropdown, Empty, Input, Table } from "antd";
import { MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { clientSortColumns, tableRowNumberColumn } from "../../shared/table-sorting.js";
import {
  APPLIER_PROFILE_WORKLOAD_METRICS,
  normalizeApplierProfileWorkload,
  PROFILE_WORKLOAD_STATUS,
} from "./applier-profile-workload.js";

const profileMetricsByKey = new Map(
  APPLIER_PROFILE_WORKLOAD_METRICS.map((metric) => [metric.key, metric]),
);

const PROFILE_TABLE_METRIC_KEYS = ["assigned", "applied", "blocked", "pending", "interview"];

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

function buildColumns(page, pageSize) {
  return clientSortColumns([
    tableRowNumberColumn({ page, pageSize }),
    {
      title: "Profile",
      dataIndex: "name",
      width: 180,
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
  ]);
}

export function ApplierProfileWorkloadTable({ rows = [], dateLabel = "This period" }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const data = useMemo(() => normalizeApplierProfileWorkload(rows), [rows]);
  const columns = useMemo(() => buildColumns(page, pageSize), [page, pageSize]);
  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? data.filter((item) =>
            `${item.name} ${item.resumeName}`.toLocaleLowerCase().includes(needle),
          )
        : data,
    [data, needle],
  );

  return (
    <div className="productivity-table-shell">
      <div className="productivity-table-header">
        <div className="productivity-table-header__top">
          <div className="productivity-table-tabs productivity-table-tabs--single">
            <span className="productivity-table-tabs__label">My Active Profiles</span>
          </div>
          <span className="productivity-table-period">{dateLabel}</span>
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
            placeholder="Search profile..."
            aria-label="Search My Active Profiles by profile name"
          />
        </div>
      </div>
      {!data.length ? (
        <Empty
          className="productivity-table-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No profiles are assigned to you yet."
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
            rowKey="id"
            size="middle"
            tableLayout="fixed"
            pagination={{
              current: page,
              pageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 25, 50],
              showTotal: (total, range) =>
                `Showing ${range[0]} to ${range[1]} of ${total} profile${total === 1 ? "" : "s"}`,
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
