import React from "react";
import { Button, Input, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";

/** Keep Ant Design from client-filtering rows; list APIs already apply filters. */
export const serverSideColumnFilter = { onFilter: () => true };

export function textSearchFilterDropdown(placeholder) {
  return ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
    <div style={{ padding: 8 }} onKeyDown={(event) => event.stopPropagation()}>
      <Input
        allowClear
        placeholder={placeholder}
        value={selectedKeys[0]}
        onChange={(event) =>
          setSelectedKeys(event.target.value ? [event.target.value] : [])
        }
        onPressEnter={() => confirm()}
        style={{ marginBottom: 8, display: "block" }}
      />
      <Space>
        <Button
          type="primary"
          size="small"
          icon={<SearchOutlined />}
          onClick={() => confirm()}
        >
          Search
        </Button>
        <Button
          size="small"
          onClick={() => {
            clearFilters?.();
            confirm();
          }}
        >
          Reset
        </Button>
      </Space>
    </div>
  );
}

export function searchFilterIcon(filtered) {
  return <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />;
}

export function pickSharedColumnSearch(tableFilters, keys, currentSearch) {
  const current = currentSearch || "";
  const values = keys.map((key) => {
    const entry = tableFilters[key];
    return entry == null ? undefined : String(entry[0] || "");
  });
  const changed = values.find(
    (value) => value !== undefined && value !== current,
  );
  if (changed !== undefined) return changed;
  const present = values.find((value) => value !== undefined);
  return present !== undefined ? present : current;
}

export function firstFilterValue(tableFilters, key, fallback = "") {
  const entry = tableFilters[key];
  if (entry == null) return fallback;
  return entry[0] == null ? "" : String(entry[0]);
}
