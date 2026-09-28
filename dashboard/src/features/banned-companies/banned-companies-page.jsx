import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Flex, Input, Modal, Popconfirm, Space, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { CAPABILITIES, hasCapability } from "../../access/capabilities.js";
import { DataPagination, EllipsisCell, LoadingState } from "../../components/ui.jsx";
import {
  addGlobalBannedCompany,
  listGlobalBannedCompanies,
  removeGlobalBannedCompany,
  updateGlobalBannedCompany,
} from "../../services/global-banned-companies-service.js";
import { formatDate } from "../../shared/formatters.js";
import { ResizableTable as Table } from "../../shared/resizable-table.jsx";
import { clientSortColumns, tableRowNumberColumn } from "../../shared/table-sorting.js";
import { useTableBodyHeight } from "../../shared/use-table-body-height.js";

const { Text } = Typography;
const PAGE_SIZES = [25, 50, 100];

export function BannedCompaniesPage({ client, apiBaseUrl, access }) {
  const canManage = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [edit, setEdit] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tableHostRef, tableBodyHeight] = useTableBodyHeight(items != null);

  const load = useCallback(async () => {
    setError("");
    try {
      setItems(await listGlobalBannedCompanies(client, apiBaseUrl));
    } catch (caught) {
      setItems([]);
      setError(caught.message || "Global banned companies could not be loaded.");
    }
  }, [client, apiBaseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (items || []).filter((item) => {
      if (!query) return true;
      return `${item.companyName || ""} ${item.description || ""}`.toLowerCase().includes(query);
    });
  }, [items, search]);

  const total = visible.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize) || 1));
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagination = {
    page: currentPage,
    pageSize,
    total,
    from: total ? (currentPage - 1) * pageSize + 1 : 0,
    to: Math.min(currentPage * pageSize, total),
  };

  async function addCompany() {
    const name = companyName.replace(/\s+/g, " ").trim();
    const reason = description.replace(/\s+/g, " ").trim();
    if (!name || !reason) return;
    setBusy(true);
    setError("");
    try {
      await addGlobalBannedCompany(client, apiBaseUrl, name, reason);
      setCompanyName("");
      setDescription("");
      setPage(1);
      await load();
    } catch (caught) {
      setError(caught.message || "The company could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    const reason = String(edit?.description || "").replace(/\s+/g, " ").trim();
    if (!edit?.id || !reason) return;
    setBusy(true);
    setError("");
    try {
      await updateGlobalBannedCompany(client, apiBaseUrl, edit.id, reason);
      setEdit(null);
      await load();
    } catch (caught) {
      setError(caught.message || "The description could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCompany(id) {
    setBusy(true);
    setError("");
    try {
      await removeGlobalBannedCompany(client, apiBaseUrl, id);
      await load();
    } catch (caught) {
      setError(caught.message || "The company could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(
    () =>
      clientSortColumns([
        tableRowNumberColumn({ page: currentPage, pageSize }),
        { title: "Company", dataIndex: "companyName", width: 220, ellipsis: true, render: (value) => <EllipsisCell>{value}</EllipsisCell> },
        {
          title: "Description",
          dataIndex: "description",
          ellipsis: true,
          render: (value) => <EllipsisCell>{value}</EllipsisCell>,
        },
        {
          title: "Added",
          dataIndex: "createdAt",
          width: 220,
          render: (value) => (value ? formatDate(value) : "—"),
        },
        ...(canManage
          ? [
              {
                title: "",
                key: "actions",
                width: 180,
                render: (_, row) => (
                  <Space size={0}>
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      disabled={busy}
                      onClick={() => setEdit({ id: row.id, companyName: row.companyName, description: row.description || "" })}
                    >
                      Edit
                    </Button>
                    <Popconfirm title={`Remove ${row.companyName}?`} onConfirm={() => removeCompany(row.id)}>
                      <Button danger type="text" icon={<DeleteOutlined />} disabled={busy}>
                        Remove
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]
          : []),
      ]),
    // removeCompany closes over the latest busy/load handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPage, pageSize, canManage, busy],
  );

  return (
    <div className="page page-list">
      <Flex className="page-toolbar" justify="space-between" align="center" wrap="wrap" gap="small">
        <Space wrap>
          <Input
            aria-label="Search banned companies"
            placeholder="Search companies"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            Refresh
          </Button>
        </Space>
        {canManage ? (
          <Space wrap>
            <Input
              aria-label="Banned company name"
              placeholder="Company name"
              maxLength={200}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              onPressEnter={addCompany}
              style={{ width: 220 }}
            />
            <Input
              aria-label="Why this company is banned"
              placeholder="Why is this company banned?"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onPressEnter={addCompany}
              style={{ width: 320 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={busy}
              disabled={!companyName.trim() || !description.trim()}
              onClick={addCompany}
            >
              Add company
            </Button>
          </Space>
        ) : (
          <Text type="secondary">You can review this list. Applying Managers and Admins add or remove companies.</Text>
        )}
      </Flex>
      <Alert
        className="ui-alert"
        type="info"
        showIcon
        message="These companies apply to every resume"
        description="JD Finders should skip a posting when the extracted company matches this list. Matching ignores extra spaces and letter case. A company banned on one resume still blocks only that resume."
      />
      {error ? (
        <Alert
          className="ui-alert"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={load}>
              Retry
            </Button>
          }
        />
      ) : null}
      {items == null ? (
        <LoadingState text="Loading banned companies…" />
      ) : (
        <Card className="page-list-card">
          <div ref={tableHostRef} className="page-list-table-host">
            <Table
              className="dashboard-ellipsis-table"
              rowKey="id"
              columns={columns}
              dataSource={pageItems}
              pagination={false}
              tableLayout="fixed"
              scroll={{ y: tableBodyHeight }}
              locale={{
                emptyText: (
                  <Space direction="vertical" size="small" style={{ padding: 24 }}>
                    <Text strong>{search.trim() ? "No matching companies" : "No global banned companies yet."}</Text>
                    <Text type="secondary">
                      {search.trim()
                        ? "No companies match this search."
                        : "Add a company when JD Finders should skip it for every profile."}
                    </Text>
                  </Space>
                ),
              }}
            />
          </div>
          <DataPagination
            data={pagination}
            pageSizeOptions={PAGE_SIZES}
            onPage={(nextPage, nextSize) => {
              const size = nextSize || pageSize;
              setPage(size !== pageSize ? 1 : nextPage);
              setPageSize(size);
            }}
          />
        </Card>
      )}
      <Modal
        title={edit ? `Why is ${edit.companyName} banned?` : "Description"}
        open={Boolean(edit)}
        okText="Save"
        confirmLoading={busy}
        okButtonProps={{ disabled: !String(edit?.description || "").trim() }}
        onCancel={() => !busy && setEdit(null)}
        onOk={saveDescription}
        destroyOnHidden
      >
        <Input.TextArea
          aria-label="Banned company description"
          rows={4}
          maxLength={500}
          showCount
          value={edit?.description || ""}
          onChange={(event) => setEdit((current) => (current ? { ...current, description: event.target.value } : current))}
        />
      </Modal>
    </div>
  );
}
