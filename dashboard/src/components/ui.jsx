import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Pagination,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { formatLabel } from "../shared/formatters.js";
import { clientSortColumns } from "../shared/table-sorting.js";

const { Text, Title } = Typography;
const tagColor = (value) =>
  ({
    ACTIVE: "green",
    INACTIVE: "red",
    ARCHIVED: "default",
    URGENT: "red",
    HIGH: "gold",
    NORMAL: "blue",
    LOW: "default",
    BLOCKED: "red",
    COMPLETED: "green",
    COMPLETED_WITH_WARNINGS: "gold",
    FAILED: "red",
    PROCESSING: "blue",
    CANCELLED: "default",
    APPLIED: "blue",
    OFFER_RECEIVED: "green",
    REJECTED: "red",
    CREATED: "green",
    DUPLICATE: "gold",
    SKIPPED: "default",
  })[String(value || "").toUpperCase()] || "blue";

export const StatusTag = ({ value }) => (
  <Tag color={tagColor(value)}>{formatLabel(value)}</Tag>
);
export const TagList = ({ values = [], empty = "None" }) =>
  values.length ? (
    <Flex gap="small" wrap>
      {values.map((value) => (
        <Tag key={value}>{value}</Tag>
      ))}
    </Flex>
  ) : (
    <Text type="secondary">{empty}</Text>
  );
export const LoadingState = ({ text = "Loading…" }) => (
  <Flex
    className="ui-state"
    align="center"
    justify="center"
    gap="small"
    role="status"
  >
    <Spin />
    <Text>{text}</Text>
  </Flex>
);
export const ErrorState = ({
  message,
  title = "Something went wrong",
  retry,
}) => (
  <Alert
    className="ui-alert"
    type="error"
    showIcon
    message={title}
    description={message}
    action={
      retry ? (
        <Button danger onClick={retry}>
          Retry
        </Button>
      ) : null
    }
  />
);
export const EmptyState = ({ title, text, onClear }) => (
  <Card>
    <Empty
      description={
        <>
          <Title level={4}>{title}</Title>
          <Text type="secondary">{text}</Text>
        </>
      }
    >
      {onClear && <Button onClick={onClear}>Clear filters</Button>}
    </Empty>
  </Card>
);
export const Metadata = ({ items, column = 2 }) => (
  <Descriptions
    bordered
    size="small"
    column={{ xs: 1, sm: 1, md: column }}
    items={items.map(([label, children], index) => ({
      key: `${label}-${index}`,
      label,
      children: children ?? "Not available",
    }))}
  />
);
export const PageCard = ({ title, extra, children, className = "" }) => (
  <Card title={title} extra={extra} className={className}>
    {children}
  </Card>
);
export function FilterPanel({
  children,
  activeCount = 0,
  title = "Filters",
  defaultOpen = false,
}) {
  const [activeKeys, setActiveKeys] = useState(
    defaultOpen || activeCount > 0 ? ["filters"] : [],
  );
  useEffect(() => {
    if (activeCount > 0) setActiveKeys(["filters"]);
  }, [activeCount]);
  return (
    <Collapse
      className="filter-collapse filter-card"
      activeKey={activeKeys}
      onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
      items={[
        {
          key: "filters",
          label: (
            <Flex align="center" gap="small" wrap>
              <Text strong>{title}</Text>
              {activeCount > 0 && (
                <Tag color="blue">{activeCount} active</Tag>
              )}
            </Flex>
          ),
          children,
        },
      ]}
    />
  );
}
export function LegacyTable({ headers, children }) {
  const rows = React.Children.toArray(children).map((row, rowIndex) => {
      const values = { key: row.key || rowIndex };
      React.Children.toArray(row.props.children).forEach((cell, index) => {
        values[index] = cell.props.children;
      });
      return values;
    }),
    columns = clientSortColumns(
      headers.map((title, index) => ({
        title,
        dataIndex: index,
        key: index,
        sortable: title !== "",
      })),
    );
  return (
    <Table
      columns={columns}
      dataSource={rows}
      pagination={false}
      scroll={{ x: "max-content" }}
      size="middle"
    />
  );
}
export const DataPagination = ({ data, onPage }) => (
  <Flex className="ui-pagination" justify="space-between" align="center" wrap>
    <Text>
      Showing {data.from}–{data.to} of {data.total}
    </Text>
    <Pagination
      current={data.page}
      pageSize={data.pageSize || Math.max(1, data.to - data.from + 1)}
      total={data.total}
      showSizeChanger={false}
      onChange={onPage}
    />
  </Flex>
);
export const PageHeading = ({ title, eyebrow, extra }) => (
  <Flex
    className="page-heading"
    align="center"
    justify="space-between"
    gap="middle"
    wrap
  >
    <div>
      {eyebrow && (
        <Text type="secondary" className="eyebrow">
          {eyebrow}
        </Text>
      )}
      <Title level={1} tabIndex={-1}>
        {title}
      </Title>
    </div>
    {extra}
  </Flex>
);
export function TabbedSections({ items = [], defaultActiveKey, extra }) {
  const available = items.filter(Boolean),
    first = defaultActiveKey || available[0]?.key,
    [active, setActive] = useState(first);
  useEffect(() => {
    if (!available.some((item) => item.key === active))
      setActive(available[0]?.key);
  }, [active, available.map((item) => item.key).join("|")]);
  useEffect(() => {
    const keydown = (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < available.length) {
        event.preventDefault();
        setActive(available[index].key);
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [available.map((item) => item.key).join("|")]);
  const tabs = available.map((item, index) => ({
    ...item,
    label: (
      <span>
        <span className="tab-number" aria-hidden="true">
          {index + 1}
        </span>
        {item.label}
      </span>
    ),
    children: <div className="tab-panel">{item.children}</div>,
  }));
  return (
    <Card className="tabbed-page-card">
      <Flex
        justify="space-between"
        align="center"
        gap="middle"
        wrap
        className="tabbed-page-help"
      >
        <Text type="secondary">
          Use Alt+1…{available.length} or focus the tabs and use arrow keys.
        </Text>
        {extra}
      </Flex>
      <Tabs
        activeKey={active}
        onChange={setActive}
        items={tabs}
        destroyOnHidden={false}
      />
    </Card>
  );
}
