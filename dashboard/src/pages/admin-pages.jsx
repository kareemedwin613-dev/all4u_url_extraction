import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Input,
  Select,
  Space,
  Table as AntTable,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import {
  AccountStatusBadge,
  RoleBadges,
} from "../components/access-components.jsx";
import {
  DataPagination,
  ErrorState,
  LoadingState,
  TabbedSections,
} from "../components/ui.jsx";
import { navigate } from "../router.js";
import {
  assignRole,
  getUser,
  listUsers,
  removeRole,
  setStatus,
} from "../services/admin-user-service.js";
import { USER_PAGE_SIZES } from "../shared/constants.js";
import { formatDate } from "../shared/formatters.js";
import { parseUserQuery, serializeQuery } from "../shared/query-state.js";
import {
  clientSortColumns,
  serverSortColumns,
  serverSortFromTable,
} from "../shared/table-sorting.js";
import { normalizeSearch } from "../shared/validation.js";

const { Text, Title } = Typography;

function textSearchFilterDropdown(placeholder) {
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

function pickSharedColumnSearch(tableFilters, keys, currentSearch) {
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

/** Keep Ant Design from client-filtering rows; list APIs already apply filters. */
const serverSideColumnFilter = { onFilter: () => true };

export function AdminUsersPage({ client, apiBaseUrl, roles, query, reload }) {
  const filters = parseUserQuery(query),
    [result, setResult] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listUsers(client, apiBaseUrl, filters)
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
  }, [client, apiBaseUrl, query, reload]);
  const update = (patch) => {
      const value = serializeQuery({ ...filters, ...patch });
      navigate(`#/admin/users${value ? `?${value}` : ""}`);
    },
    searchFiltered = filters.search ? [filters.search] : null,
    columns = useMemo(
      () =>
        serverSortColumns(
          [
            {
              title: "Name",
              dataIndex: "full_name",
              sortKey: "name",
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: textSearchFilterDropdown(
                "Search name or email",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined
                  style={{ color: filtered ? "#1677ff" : undefined }}
                />
              ),
              render: (value) => value || "Name not provided",
            },
            {
              title: "Email",
              dataIndex: "email",
              sortKey: "email",
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: textSearchFilterDropdown(
                "Search name or email",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined
                  style={{ color: filtered ? "#1677ff" : undefined }}
                />
              ),
            },
            {
              title: "Status",
              dataIndex: "status",
              sortKey: "status",
              filters: [
                { text: "Active", value: "ACTIVE" },
                { text: "Inactive", value: "INACTIVE" },
              ],
              filterMultiple: false,
              filteredValue: filters.status ? [filters.status] : null,
              ...serverSideColumnFilter,
              render: (value) => <AccountStatusBadge status={value} />,
            },
            {
              title: "Roles",
              dataIndex: "role_codes",
              sortKey: "roles",
              filters: roles.map((role) => ({
                text: role.name,
                value: role.code,
              })),
              filterMultiple: false,
              filteredValue: filters.roleCode ? [filters.roleCode] : null,
              ...serverSideColumnFilter,
              render: (value) => <RoleBadges roles={value || []} />,
            },
            {
              title: "Created",
              dataIndex: "created_at",
              sortKey: "created",
              render: formatDate,
            },
            {
              title: "Actions",
              key: "actions",
              render: (_, user) => (
                <Button type="link" href={`#/admin/users/${user.id}`}>
                  Manage
                </Button>
              ),
            },
          ],
          filters.sort,
        ),
      [
        filters.roleCode,
        filters.search,
        filters.sort,
        filters.status,
        roles,
        searchFiltered,
      ],
    ),
    paginationData = result
      ? {
          ...result,
          from: result.total
            ? (result.page - 1) * result.pageSize + 1
            : 0,
          to: result.total
            ? Math.min(result.page * result.pageSize, result.total)
            : 0,
        }
      : null;
  return (
    <div className="page">
      <Title level={1} tabIndex={-1}>
        Users
      </Title>
      {error && !result ? (
        <ErrorState title="Users could not be loaded" message={error} />
      ) : !result && loading ? (
        <LoadingState text="Loading users…" />
      ) : !result ? (
        <ErrorState
          title="Users could not be loaded"
          message={error || "Users could not be loaded."}
        />
      ) : (
        <Card>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 12 }}
            />
          )}
          <AntTable
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={result.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 400px)" }}
            locale={{
              emptyText: (
                <Space
                  direction="vertical"
                  size="small"
                  style={{ padding: 24 }}
                >
                  <Text strong>No users</Text>
                  <Text type="secondary">
                    {filters.search || filters.status || filters.roleCode
                      ? "No users match the current filters."
                      : "No registered profiles were found."}
                  </Text>
                  {(filters.search || filters.status || filters.roleCode) && (
                    <Button onClick={() => navigate("#/admin/users")}>
                      Clear filters
                    </Button>
                  )}
                </Space>
              ),
            }}
            onChange={(_pagination, tableFilters, sorter, extra) => {
              if (
                extra?.action &&
                extra.action !== "filter" &&
                extra.action !== "sort"
              )
                return;
              let search = filters.search;
              try {
                search = normalizeSearch(
                  pickSharedColumnSearch(
                    tableFilters,
                    ["full_name", "email"],
                    filters.search,
                  ),
                );
              } catch {
                search = filters.search;
              }
              update({
                search,
                status: tableFilters.status?.[0] || "",
                roleCode: tableFilters.role_codes?.[0] || "",
                sort: serverSortFromTable(sorter, "created_desc"),
                page: 1,
              });
            }}
          />
          <DataPagination
            data={paginationData}
            pageSizeOptions={USER_PAGE_SIZES}
            onPage={(page, pageSize) =>
              update({
                page,
                ...(pageSize ? { pageSize } : {}),
              })
            }
          />
        </Card>
      )}
    </div>
  );
}

export function AdminUserDetailPage({
  client,
  apiBaseUrl,
  id,
  roles,
  currentUserId,
  onCurrentUserChanged,
}) {
  const { modal } = AntApp.useApp(),
    [user, setUser] = useState(),
    [selected, setSelected] = useState(new Set()),
    [statusValue, setStatusValue] = useState("ACTIVE"),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const value = await getUser(client, apiBaseUrl, id);
      setUser(value);
      setSelected(new Set(value.roles || []));
      setStatusValue(value.status);
    } catch (value) {
      setError(value.message);
    }
  }, [client, apiBaseUrl, id]);
  useEffect(() => {
    load();
  }, [load]);
  const changed = useMemo(
    () =>
      user &&
      roles.some(
        (role) =>
          selected.has(role.code) !== (user.roles || []).includes(role.code),
      ),
    [roles, selected, user],
  );
  function toggle(code) {
    setSelected((value) => {
      const next = new Set(value);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }
  async function saveRoles() {
    setBusy(true);
    setMessage("");
    try {
      const before = new Set(user.roles || []),
        toAssign = roles.filter(
          (role) => selected.has(role.code) && !before.has(role.code),
        ),
        toRemove = roles.filter(
          (role) => !selected.has(role.code) && before.has(role.code),
        );
      await Promise.all([
        ...toAssign.map((role) => assignRole(client, apiBaseUrl, id, role.code)),
        ...toRemove.map((role) => removeRole(client, apiBaseUrl, id, role.code)),
      ]);
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage("Role assignments saved successfully.");
    } catch (value) {
      setMessage(
        `${value.message} Any completed role changes were retained; the current assignments have been reloaded.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function applyStatus() {
    setBusy(true);
    setMessage("");
    try {
      await setStatus(client, apiBaseUrl, id, statusValue);
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage("Account status updated successfully.");
    } catch (value) {
      setMessage(value.message);
      setStatusValue(user.status);
    } finally {
      setBusy(false);
    }
  }
  function saveStatus() {
    if (statusValue === "INACTIVE" && user.status !== "INACTIVE")
      modal.confirm({
        title: "Deactivate this account?",
        content:
          "The user remains in Supabase Auth but will no longer be able to access platform data.",
        okText: "Deactivate",
        okButtonProps: { danger: true },
        onOk: applyStatus,
      });
    else applyStatus();
  }
  if (error)
    return (
      <div className="page">
        <Button type="link" href="#/admin/users">
          ← Back to Users
        </Button>
        <ErrorState title="User could not be loaded" message={error} />
      </div>
    );
  if (!user) return <LoadingState text="Loading user…" />;
  const tabs = [
    {
      key: "identity",
      label: "Identity",
      children: (
        <Descriptions
          bordered
          column={{ xs: 1, md: 2 }}
          items={[
            {
              key: "name",
              label: "Full name",
              children: user.fullName || "Name not provided",
            },
            { key: "email", label: "Email", children: user.email },
            {
              key: "id",
              label: "User ID",
              children: (
                <Text code copyable>
                  {user.id}
                </Text>
              ),
            },
            {
              key: "created",
              label: "Created",
              children: formatDate(user.createdAt),
            },
          ]}
        />
      ),
    },
    {
      key: "status",
      label: "Account status",
      children: (
        <>
          <Text>
            Deactivate platform access without deleting the Supabase Auth
            account.
          </Text>
          <div className="tab-form-actions">
            <Space wrap>
              <Select
                value={statusValue}
                disabled={busy}
                onChange={setStatusValue}
                style={{ width: 180 }}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
              />
              <Button
                type="primary"
                disabled={busy || statusValue === user.status}
                loading={busy}
                onClick={saveStatus}
              >
                Apply Status
              </Button>
            </Space>
          </div>
        </>
      ),
    },
    {
      key: "roles",
      label: "System roles",
      children: (
        <>
          <Text>
            Roles are fixed system definitions. Select one or more assignments
            for this user.
          </Text>
          <div className="role-options">
            {roles.map((role) => (
              <Card size="small" key={role.code}>
                <Checkbox
                  checked={selected.has(role.code)}
                  disabled={busy}
                  onChange={() => toggle(role.code)}
                >
                  <strong>{role.name}</strong>
                </Checkbox>
                <div>
                  <Text type="secondary">{role.description}</Text>
                </div>
              </Card>
            ))}
          </div>
          <Button
            type="primary"
            disabled={busy || !changed}
            loading={busy}
            onClick={saveRoles}
          >
            Save Role Assignments
          </Button>
        </>
      ),
    },
  ];
  return (
    <div className="page">
      <Button type="link" href="#/admin/users">
        ← Back to Users
      </Button>
      <Title level={1} tabIndex={-1}>
        Manage User
      </Title>
      {id === currentUserId && (
        <Alert
          type="warning"
          showIcon
          message="You are editing your own account. Role or status changes may affect your current access."
        />
      )}
      {message && (
        <Alert
          type={message.includes("successfully") ? "success" : "error"}
          showIcon
          message={message}
        />
      )}
      <TabbedSections items={tabs} />
    </div>
  );
}

export function AdminRolesPage({ roles }) {
  const columns = clientSortColumns([
    { title: "Role name", dataIndex: "name" },
    {
      title: "Role code",
      dataIndex: "code",
      render: (value) => <Text code>{value}</Text>,
    },
    { title: "Description", dataIndex: "description" },
    {
      title: "Active status",
      dataIndex: "active",
      render: (value) => (
        <AccountStatusBadge status={value ? "ACTIVE" : "INACTIVE"} />
      ),
    },
  ]);
  return (
    <div className="page">
      <Title level={1} tabIndex={-1}>
        System Roles
      </Title>
      <Text>These roles are fixed and read-only.</Text>
      <Card>
        <AntTable
          rowKey="code"
          columns={columns}
          dataSource={roles}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}
