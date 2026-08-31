import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Flex,
  Input,
  Select,
  Space,
  Table as AntTable,
  Tag,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import {
  AccountStatusBadge,
  RoleBadges,
} from "../components/access-components.jsx";
import { ProfileAvatarEditor } from "../components/profile-avatar-editor.jsx";
import { UserAvatar } from "../components/user-avatar.jsx";
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
  updateUserProfile,
} from "../services/admin-user-service.js";
import { USER_PAGE_SIZES, USER_ROLE_PENDING } from "../shared/constants.js";
import { formatDate } from "../shared/formatters.js";
import { parseUserQuery, serializeQuery } from "../shared/query-state.js";
import {
  clientSortColumns,
  serverSortColumns,
  serverSortFromTable,
} from "../shared/table-sorting.js";
import { normalizeSearch } from "../shared/validation.js";
import { useTableBodyHeight } from "../shared/use-table-body-height.js";

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
              title: "No",
              key: "no",
              width: 64,
              sortable: false,
              render: (_value, _row, index) =>
                ((filters.page || 1) - 1) * (filters.pageSize || 25) + index + 1,
            },
            {
              title: "Name",
              dataIndex: "full_name",
              sortKey: "name",
              width: 260,
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
              render: (value, record) => (
                <div className="admin-user-name-cell">
                  <UserAvatar
                    client={client}
                    apiBaseUrl={apiBaseUrl}
                    userId={record.id}
                    name={value || record.email}
                    size={32}
                    hasAvatar={record.has_avatar}
                    avatarUpdatedAt={record.avatar_updated_at}
                  />
                  <a href={`#/admin/users/${record.id}`}>
                    {value || "Name not provided"}
                  </a>
                </div>
              ),
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
              filters: [
                { text: "Pending Approval", value: USER_ROLE_PENDING },
                ...roles.map((role) => ({
                  text: role.name,
                  value: role.code,
                })),
              ],
              filterMultiple: false,
              filteredValue: filters.roleCode ? [filters.roleCode] : null,
              ...serverSideColumnFilter,
              render: (value) =>
                value?.length ? (
                  <RoleBadges roles={value} />
                ) : (
                  <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                    Pending Approval
                  </Tag>
                ),
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
              width: 96,
              sortable: false,
              render: (_, user) => (
                <a href={`#/admin/users/${user.id}`}>
                  {!user.role_codes?.length && user.status === "ACTIVE"
                    ? "Review"
                    : "Manage"}
                </a>
              ),
            },          ],
          filters.sort,
        ),
      [
        client,
        apiBaseUrl,
        filters.page,
        filters.pageSize,
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
  const [tableHostRef, tableBodyHeight] = useTableBodyHeight(Boolean(result));
  return (
    <div className="page page-list">
      <Flex className="page-toolbar" justify="space-between" align="center" wrap="wrap" gap="small">
        <Space wrap>
          <Button
            type={filters.roleCode === USER_ROLE_PENDING ? "primary" : "default"}
            onClick={() =>
              update({
                roleCode:
                  filters.roleCode === USER_ROLE_PENDING
                    ? ""
                    : USER_ROLE_PENDING,
                status: filters.roleCode === USER_ROLE_PENDING ? "" : "ACTIVE",
                page: 1,
              })
            }
          >
            Pending Approvals
          </Button>
          {(filters.search || filters.status || filters.roleCode) && (
            <Button onClick={() => navigate("#/admin/users")}>Clear Filters</Button>
          )}
        </Space>
      </Flex>
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
        <Card className="page-list-card">
          {filters.roleCode === USER_ROLE_PENDING && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Pending Approvals"
              description="These members signed up and are waiting for a role assignment. Open Review to accept (assign roles) or reject (deactivate)."
            />
          )}
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 12 }}
            />
          )}
          <div ref={tableHostRef} className="page-list-table-host">
            <AntTable
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={result.items}
              pagination={false}
              scroll={{ x: "max-content", y: tableBodyHeight }}
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
                  sort: serverSortFromTable(sorter, "name_asc"),
                  page: 1,
                });
              }}
            />
          </div>
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
    [fullNameValue, setFullNameValue] = useState(""),
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
      setFullNameValue(value.fullName || "");
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
      if (!before.size && !toAssign.length) {
        setMessage("Select at least one role to approve this registration.");
        setBusy(false);
        return;
      }
      await Promise.all([
        ...toAssign.map((role) => assignRole(client, apiBaseUrl, id, role.code)),
        ...toRemove.map((role) => removeRole(client, apiBaseUrl, id, role.code)),
      ]);
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage(
        before.size
          ? "Role assignments saved successfully."
          : "Registration approved. Role assignments saved successfully.",
      );
    } catch (value) {
      setMessage(
        `${value.message} Any completed role changes were retained; the current assignments have been reloaded.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function rejectRegistration() {
    setBusy(true);
    setMessage("");
    try {
      await setStatus(client, apiBaseUrl, id, "INACTIVE");
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage("Registration rejected. The account is now inactive.");
    } catch (value) {
      setMessage(value.message);
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
      setMessage("Account Status updated successfully.");
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
  async function saveFullName() {
    setBusy(true);
    setMessage("");
    try {
      await updateUserProfile(client, apiBaseUrl, id, fullNameValue);
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage("Full Name updated successfully.");
    } catch (value) {
      setMessage(value.message);
      setFullNameValue(user.fullName || "");
    } finally {
      setBusy(false);
    }
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
  const pendingApproval =
    user.status === "ACTIVE" && !(user.roles || []).length;
  const nameDirty =
    String(fullNameValue || "").trim() !== String(user.fullName || "").trim();
  const tabs = [
    {
      key: "identity",
      label: "Identity",
      children: (
        <>
          <ProfileAvatarEditor
            client={client}
            apiBaseUrl={apiBaseUrl}
            userId={user.id}
            name={user.fullName || user.email}
            hasAvatar={user.hasAvatar}
            avatarUpdatedAt={user.avatarUpdatedAt}
            admin
            onChanged={load}
          />
          <Descriptions
            bordered
            column={{ xs: 1, md: 2 }}
            style={{ marginTop: 16 }}
            items={[
              {
                key: "name",
                label: "Full Name",
                children: (
                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      value={fullNameValue}
                      maxLength={200}
                      disabled={busy}
                      onChange={(event) => setFullNameValue(event.target.value)}
                      placeholder="Enter full name"
                      aria-label="Full Name"
                      style={{ minWidth: 240 }}
                    />
                    <Button
                      type="primary"
                      disabled={busy || !nameDirty}
                      loading={busy}
                      onClick={saveFullName}
                    >
                      Save name
                    </Button>
                  </Space>
                ),
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
        </>
      ),
    },
    {
      key: "status",
      label: "Account Status",
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
      label: "System Roles",
      children: (
        <>
          <Text>
            {pendingApproval
              ? "Select at least one role to approve this registration."
              : "Roles are fixed system definitions. Select one or more assignments for this user."}
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
            disabled={busy || (pendingApproval ? !selected.size : !changed)}
            loading={busy}
            onClick={saveRoles}
          >
            {pendingApproval ? "Approve And Save Roles" : "Save Role Assignments"}
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
      {pendingApproval && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Pending Registration Approval"
          description="This member signed up and has no roles yet. Select one or more roles below and save to approve, or reject to deactivate the account."
          action={
            <Button
              danger
              disabled={busy}
              onClick={() =>
                modal.confirm({
                  title: "Reject this registration?",
                  content:
                    "The account will be set to Inactive. The Auth user remains, but they cannot access platform data.",
                  okText: "Reject",
                  okButtonProps: { danger: true },
                  onOk: rejectRegistration,
                })
              }
            >
              Reject
            </Button>
          }
        />
      )}
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
    { title: "Role Name", dataIndex: "name" },
    {
      title: "Role Code",
      dataIndex: "code",
      render: (value) => <Text code>{value}</Text>,
    },
    { title: "Description", dataIndex: "description" },
    {
      title: "Active Status",
      dataIndex: "active",
      render: (value) => (
        <AccountStatusBadge status={value ? "ACTIVE" : "INACTIVE"} />
      ),
    },
  ]);
  const [tableHostRef, tableBodyHeight] = useTableBodyHeight(true);
  return (
    <div className="page page-list">
      <Text className="page-toolbar" style={{ display: "block", marginBottom: 12 }}>
        These roles are fixed and read-only.
      </Text>
      <Card className="page-list-card">
        <div ref={tableHostRef} className="page-list-table-host">
          <AntTable
            rowKey="code"
            columns={columns}
            dataSource={roles}
            pagination={false}
            scroll={{ x: "max-content", y: tableBodyHeight }}
          />
        </div>
      </Card>
    </div>
  );
}
