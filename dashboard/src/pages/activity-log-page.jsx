import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import {
  DataPagination,
  ErrorState,
  LoadingState,
} from "../components/ui.jsx";
import { OverviewDateFilter } from "../features/overview/overview-date-filter.jsx";
import {
  DEFAULT_OVERVIEW_WINDOW,
  overviewDateBounds,
} from "../features/overview/overview-date.js";
import { navigate } from "../router.js";
import {
  ACTIVITY_LOG_ACTIONS,
  listActivityLog,
} from "../services/activity-log-service.js";
import { formatDate, formatLabel } from "../shared/formatters.js";
import {
  activityLogActionColor,
  formatActivityLogDetail,
} from "../services/activity-log-ui.js";
import { useTableBodyHeight } from "../shared/use-table-body-height.js";

const { Text, Title } = Typography;
const PAGE_SIZES = [25, 50, 100];

function parseActivityLogQuery(search = "") {
  const params = new URLSearchParams(search);
  const window = params.get("window") || DEFAULT_OVERVIEW_WINDOW.window;
  const applierId = params.get("applierId") || "";
  return {
    window,
    from: params.get("from") || "",
    to: params.get("to") || "",
    applierId,
    search: String(params.get("search") || "").slice(0, 100),
    action: String(params.get("action") || "").toUpperCase(),
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
    pageSize: PAGE_SIZES.includes(Number(params.get("pageSize")))
      ? Number(params.get("pageSize"))
      : 50,
  };
}

function periodFromQuery(query) {
  const filters = parseActivityLogQuery(query);
  if (filters.window === "CUSTOM" && filters.from && filters.to) {
    return {
      window: "CUSTOM",
      from: filters.from,
      to: filters.to,
      label: `${filters.from} - ${filters.to}`,
    };
  }
  const preset =
    DEFAULT_OVERVIEW_WINDOW.window === filters.window
      ? DEFAULT_OVERVIEW_WINDOW
      : {
          window: filters.window,
          from: "",
          to: "",
          label: formatLabel(filters.window),
        };
  return preset;
}

function pushActivityLogRoute(state, period) {
  const params = new URLSearchParams();
  if (period.window !== DEFAULT_OVERVIEW_WINDOW.window) {
    params.set("window", period.window);
  }
  if (period.window === "CUSTOM") {
    if (period.from) params.set("from", period.from);
    if (period.to) params.set("to", period.to);
  }
  if (state.search) params.set("search", state.search);
  if (state.action) params.set("action", state.action);
  if (state.applierId) params.set("applierId", state.applierId);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== 50) params.set("pageSize", String(state.pageSize));
  const query = params.toString();
  navigate(`#/admin/activity-log${query ? `?${query}` : ""}`, { replace: true });
}

export function ActivityLogPage({ client, apiBaseUrl, query }) {
  const filters = useMemo(() => parseActivityLogQuery(query), [query]);
  const [period, setPeriod] = useState(() => periodFromQuery(query));
  const [searchInput, setSearchInput] = useState(filters.search);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => overviewDateBounds(period), [period]);
  const [tableHostRef, tableBodyHeight] = useTableBodyHeight(Boolean(result));
  const paginationData = result
    ? {
        ...result,
        from: result.total ? (result.page - 1) * result.pageSize + 1 : 0,
        to: result.total ? Math.min(result.page * result.pageSize, result.total) : 0,
      }
    : null;

  useEffect(() => {
    setPeriod(periodFromQuery(query));
    setSearchInput(parseActivityLogQuery(query).search);
  }, [query]);

  useEffect(() => {
    let active = true;
    if (!range) {
      setError("Select a valid reporting period.");
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError("");
    listActivityLog(client, apiBaseUrl, {
      from: range.from,
      to: range.to,
      applierId: filters.applierId || "",
      search: filters.search,
      action: ACTIVITY_LOG_ACTIONS.includes(filters.action) ? filters.action : "",
      page: filters.page,
      pageSize: filters.pageSize,
    })
      .then((value) => {
        if (!active) return;
        setResult(value);
        setLoading(false);
      })
      .catch((value) => {
        if (!active) return;
        setError(value.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, client, filters, range]);

  const applyFilters = (patch) => {
    const next = {
      search: searchInput,
      action: ACTIVITY_LOG_ACTIONS.includes(filters.action) ? filters.action : "",
      applierId: filters.applierId || "",
      page: filters.page,
      pageSize: filters.pageSize,
      ...patch,
    };
    pushActivityLogRoute(next, period);
  };

  const columns = [
    {
      title: "Time",
      dataIndex: "occurred_at",
      width: 180,
      render: (value) => formatDate(value),
    },
    {
      title: "Applier",
      dataIndex: "applier_name",
      width: 160,
      render: (value) => value || "—",
    },
    {
      title: "Action",
      dataIndex: "action_label",
      width: 220,
      render: (value, record) => (
        <Tag color={activityLogActionColor(record.action)}>{value || formatLabel(record.action)}</Tag>
      ),
    },
    {
      title: "Job Title",
      dataIndex: "job_title",
      ellipsis: true,
      render: (value, record) =>
        value ? (
          <span title={record.company ? `${value} — ${record.company}` : value}>
            {value}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "Application",
      dataIndex: "application_number",
      width: 130,
      render: (value, record) =>
        record.application_id ? (
          <Button type="link" href={`#/applications/${record.application_id}`} style={{ padding: 0 }}>
            {value ? `#${value}` : "Open"}
          </Button>
        ) : (
          "—"
        ),
    },
    {
      title: "IP",
      dataIndex: "ip_address",
      width: 120,
      render: (value) => value || "—",
    },
  ];

  return (
    <div className="page page-list">
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={16} style={{ marginBottom: 16 }}>
        <div>
          <Title level={1} tabIndex={-1} style={{ marginBottom: 4 }}>
            Activity Log
          </Title>
          <Text type="secondary">
            Audit trail of application status changes, screenshots, assignments, and extension activity.
          </Text>
        </div>
        <OverviewDateFilter
          compact
          value={period}
          onChange={(value) => {
            setPeriod(value);
            pushActivityLogRoute(
              {
                search: filters.search,
                action: filters.action,
                page: 1,
                pageSize: filters.pageSize,
              },
              value,
            );
          }}
        />
      </Flex>

      <Card className="page-list-card">
        <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search job, applier, or application #"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onPressEnter={() => applyFilters({ page: 1 })}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="All actions"
            value={ACTIVITY_LOG_ACTIONS.includes(filters.action) ? filters.action : undefined}
            style={{ width: 240 }}
            options={ACTIVITY_LOG_ACTIONS.map((value) => ({
              value,
              label: formatLabel(value),
            }))}
            onChange={(value) => applyFilters({ action: value || "", page: 1 })}
          />
          <Space>
            <Button type="primary" onClick={() => applyFilters({ page: 1 })}>
              Apply
            </Button>
            <Button
              onClick={() => {
                setSearchInput("");
                applyFilters({ search: "", action: "", page: 1 });
              }}
            >
              Reset
            </Button>
          </Space>
        </Flex>

        {error && !result ? (
          <ErrorState message={error} retry={() => applyFilters({})} />
        ) : !result && loading ? (
          <LoadingState text="Loading activity log…" />
        ) : !result ? (
          <ErrorState message={error || "The activity log could not be loaded."} retry={() => applyFilters({})} />
        ) : (
          <>
            {error ? (
              <Text type="danger" style={{ display: "block", marginBottom: 12 }}>
                {error}
              </Text>
            ) : null}
            <div ref={tableHostRef} className="page-list-table-host">
              <Table
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={result.items}
                pagination={false}
                scroll={{ x: "max-content", y: tableBodyHeight }}
                size="middle"
              />
            </div>
            <DataPagination
              data={paginationData}
              pageSizeOptions={PAGE_SIZES}
              onPage={(page, pageSize) => applyFilters({ page, pageSize: pageSize || filters.pageSize })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
