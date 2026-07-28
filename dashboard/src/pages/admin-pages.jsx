import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Flex,
  Input,
  Pagination,
  Select,
  Space,
  Table as AntTable,
  Typography,
} from "antd";
import {
  AccountStatusBadge,
  RoleBadges,
} from "../components/access-components.jsx";
import {
  ErrorState,
  FilterPanel,
  LoadingState,
  TabbedSections,
} from "../components/ui.jsx";
import {
  assignRole,
  getUser,
  listUsers,
  removeRole,
  setStatus,
} from "../services/admin-user-service.js";
import { formatDate } from "../shared/formatters.js";
import {
  clientSortColumns,
  serverSortColumns,
  serverSortFromTable,
} from "../shared/table-sorting.js";
import { useDebouncedValue } from "../shared/use-debounced-value.js";

const { Text, Title } = Typography,
  Table = (props) => (
    <AntTable {...props} columns={clientSortColumns(props.columns)} />
  ),
  PAGE_SIZES = [25, 50, 100];

export function AdminUsersPage({ client, apiBaseUrl, roles, reload }) {
  const [searchInput, setSearchInput] = useState(""),
    debouncedSearch = useDebouncedValue(searchInput, 300),
    [filters, setFilters] = useState({
      search: "",
      status: null,
      roleCode: null,
      sort: "created_desc",
      page: 1,
      pageSize: 25,
    }),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    setFilters((value) => ({ ...value, search: debouncedSearch.trim(), page: 1 }));
  }, [debouncedSearch]);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    listUsers(client, apiBaseUrl, filters)
      .then((value) => active && setResult(value))
      .catch((value) => active && setError(value.message));
    return () => {
      active = false;
    };
  }, [client, apiBaseUrl, filters, reload]);
  const change = (patch) => setFilters((value) => ({ ...value, ...patch })),
    columns = useMemo(
      () =>
        serverSortColumns(
          [
            {
              title: "Name",
              dataIndex: "full_name",
              sortKey: "name",
              render: (value) => value || "Name not provided",
            },
            { title: "Email", dataIndex: "email", sortKey: "email" },
            {
              title: "Status",
              dataIndex: "status",
              sortKey: "status",
              render: (value) => <AccountStatusBadge status={value} />,
            },
            {
              title: "Roles",
              dataIndex: "role_codes",
              sortKey: "roles",
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
      [filters.sort],
    );
  return (
    <div className="page">
      <Title level={1} tabIndex={-1}>
        Users
      </Title>
      <FilterPanel
        activeCount={[
          filters.search,
          filters.status,
          filters.roleCode,
        ].filter(Boolean).length}
      >
        <Flex gap="middle" wrap>
          <Input.Search
            aria-label="Search name or email"
            placeholder="Search name or email"
            value={searchInput}
            maxLength={100}
            allowClear
            onChange={(event) => setSearchInput(event.target.value)}
            style={{ width: 280 }}
          />
          <Select
            aria-label="Status"
            value={filters.status || ""}
            onChange={(value) => change({ status: value || null, page: 1 })}
            style={{ width: 170 }}
            options={[
              { value: "", label: "All statuses" },
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
          />
          <Select
            aria-label="Role"
            value={filters.roleCode || ""}
            onChange={(value) => change({ roleCode: value || null, page: 1 })}
            style={{ width: 210 }}
            options={[
              { value: "", label: "All roles" },
              ...roles.map((role) => ({ value: role.code, label: role.name })),
            ]}
          />
          <Select
            aria-label="Page size"
            value={filters.pageSize}
            onChange={(value) => change({ pageSize: value, page: 1 })}
            style={{ width: 130 }}
            options={PAGE_SIZES.map((value) => ({
              value,
              label: `${value} rows`,
            }))}
          />
        </Flex>
      </FilterPanel>
      {error ? (
        <ErrorState title="Users could not be loaded" message={error} />
      ) : !result ? (
        <LoadingState text="Loading users…" />
      ) : !result.items.length ? (
        <Card>
          <Empty
            description={
              filters.search || filters.status || filters.roleCode
                ? "No users match the current filters."
                : "No registered profiles were found."
            }
          />
        </Card>
      ) : (
        <Card>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={result.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 390px)" }}
            onChange={(_pagination, _tableFilters, sorter) =>
              change({
                sort: serverSortFromTable(sorter, "created_desc"),
                page: 1,
              })
            }
          />
          <Flex
            justify="space-between"
            align="center"
            wrap
            gap="middle"
            style={{ marginTop: 16 }}
          >
            <Text>{result.total} users</Text>
            <Pagination
              current={result.page}
              pageSize={result.pageSize}
              total={result.total}
              showSizeChanger={false}
              onChange={(page) => change({ page })}
            />
          </Flex>
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
        <Table
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
