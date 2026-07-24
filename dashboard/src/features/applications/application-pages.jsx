import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Statistic,
  Table as AntTable,
  Tag,
  Typography,
} from "antd";
import { formatDate, formatLabel } from "../../shared/formatters.js";
import { safeExternalUrl } from "../../shared/url.js";
import {
  clientSortColumns,
  serverSortColumns,
  serverSortFromTable,
} from "../../shared/table-sorting.js";
import {
  ErrorState,
  LoadingState,
  StatusTag,
  TabbedSections,
} from "../../components/ui.jsx";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_SORTS,
  APPLICATION_STATUSES,
  DUE_FILTERS,
  WORK_STATUSES,
} from "./constants.js";
import { applicationActions, isApplicationManager } from "./validation.js";
import {
  parseApplicationQuery,
  serializeApplicationQuery,
} from "./query-state.js";
import {
  bulkAssignApplications,
  createApplication,
  getApplication,
  getApplicationCounts,
  listActiveAppliers,
  listApplicationJobs,
  listApplicationResumes,
  listApplications,
  openApplicationResume,
  reassignApplication,
  updateApplication,
} from "./application-service.js";
import { listApplicationBatchOptions } from "../bulk-applications/bulk-service.js";

const { Text, Title } = Typography,
  Table = (props) => (
    <AntTable {...props} columns={clientSortColumns(props.columns)} />
  ),
  go = (hash) => location.assign(hash),
  toLocal = (value) =>
    value ? new Date(value).toISOString().slice(0, 16) : "",
  fromLocal = (value) => (value ? new Date(value).toISOString() : null),
  name = (user) => user?.display_name || user?.email || "Unassigned";
const Notice = ({ message, error = false }) =>
  message ? (
    <Alert
      className="ui-alert"
      type={error ? "error" : "success"}
      showIcon
      message={message}
    />
  ) : null;

export function ApplicationCountCards({ client, access, reload }) {
  const [data, setData] = useState(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    getApplicationCounts(client)
      .then((x) => live && setData(x))
      .catch((x) => live && setError(x.message));
    return () => {
      live = false;
    };
  }, [client, reload]);
  if (error) return <Notice message={error} error />;
  if (!data) return <LoadingState />;
  const manager = isApplicationManager(access),
    cards = manager
      ? [
          ["Total Applications", data.total],
          ["Unassigned", data.unassigned],
          ["In Progress", data.in_progress],
          ["Blocked", data.blocked],
          ["Overdue", data.overdue],
          ["Applied Today", data.applied_today],
          ["Interviews", data.interviews],
        ]
      : [
          ["My Assigned Applications", data.my_assigned],
          ["Due Today", data.due_today],
          ["In Progress", data.in_progress],
          ["Blocked", data.blocked],
          ["Applied Today", data.applied_today],
          ["Interviews", data.interviews],
        ];
  return (
    <section>
      <Title level={2}>Application workflow</Title>
      <Row gutter={[16, 16]} className="summary-grid application-counts">
        {cards.map(([label, value]) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={label}>
            <Card>
              <Statistic title={label} value={Number(value || 0)} />
            </Card>
          </Col>
        ))}
      </Row>
    </section>
  );
}

function ApplicationFilters({
  value,
  manager,
  appliers,
  batches,
  categories,
  onApply,
  onClear,
}) {
  const field = { xs: 24, sm: 12, lg: 6 };
  return (
    <Card className="filter-card">
      <Form
        layout="vertical"
        initialValues={value}
        key={serializeApplicationQuery(value)}
        onFinish={(raw) =>
          onApply({ ...raw, page: 1, pageSize: Number(raw.pageSize) })
        }
      >
        <Row gutter={12}>
          <Col {...field}>
            <Form.Item label="Search" name="search">
              <Input.Search
                maxLength={100}
                allowClear
                placeholder="Application #, company, or job title"
              />
            </Form.Item>
          </Col>
          {manager && (
            <Col {...field}>
              <Form.Item label="Assigned Applier" name="assignedTo">
                <Select
                  options={[
                    { value: "", label: "All Appliers" },
                    {
                      value: "00000000-0000-4000-8000-000000000000",
                      label: "Unassigned",
                    },
                    ...appliers.map((x) => ({ value: x.id, label: name(x) })),
                  ]}
                />
              </Form.Item>
            </Col>
          )}
          <Col {...field}>
            <Form.Item label="Work status" name="workStatus">
              <Select
                options={[
                  { value: "", label: "All work statuses" },
                  ...WORK_STATUSES.map((value) => ({
                    value,
                    label: formatLabel(value),
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Application status" name="applicationStatus">
              <Select
                options={[
                  { value: "", label: "All application statuses" },
                  ...APPLICATION_STATUSES.map((value) => ({
                    value,
                    label: formatLabel(value),
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Priority" name="priority">
              <Select
                options={[
                  { value: "", label: "All priorities" },
                  ...APPLICATION_PRIORITIES.map((value) => ({
                    value,
                    label: formatLabel(value),
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Company" name="company">
              <Input maxLength={100} />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Primary category" name="categoryId">
              <Select
                options={[
                  { value: "", label: "All categories" },
                  ...(categories?.primary || []).map((x) => ({
                    value: x.id,
                    label: x.name,
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Due date" name="dueFilter">
              <Select
                options={[
                  { value: "", label: "Any due date" },
                  ...DUE_FILTERS.map(([value, label]) => ({ value, label })),
                ]}
              />
            </Form.Item>
          </Col>
          {manager && (
            <>
              <Col {...field}>
                <Form.Item label="Created in" name="creationMode">
                  <Select
                    options={[
                      { value: "", label: "Bulk or individual" },
                      { value: "BULK", label: "Created in bulk" },
                      { value: "INDIVIDUAL", label: "Created individually" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col {...field}>
                <Form.Item label="Creation batch" name="creationBatchId">
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={[
                      { value: "", label: "All creation batches" },
                      ...batches.map((x) => ({
                        value: x.id,
                        label: x.name || `Batch ${String(x.id).slice(0, 8)}`,
                      })),
                    ]}
                  />
                </Form.Item>
              </Col>
            </>
          )}
          <Col {...field}>
            <Form.Item label="Sort" name="sort">
              <Select
                options={APPLICATION_SORTS.map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Page size" name="pageSize">
              <Select
                options={[25, 50, 100].map((value) => ({
                  value,
                  label: String(value),
                }))}
              />
            </Form.Item>
          </Col>
          <Col {...field} className="filter-actions">
            <Space>
              <Button type="primary" htmlType="submit">
                Apply
              </Button>
              <Button onClick={onClear}>Clear</Button>
            </Space>
          </Col>
        </Row>
      </Form>
    </Card>
  );
}

export function ApplicationsPage({
  client,
  access,
  categories,
  query,
  reload,
}) {
  const manager = isApplicationManager(access),
    filters = parseApplicationQuery(query),
    [data, setData] = useState(),
    [appliers, setAppliers] = useState([]),
    [batches, setBatches] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selectedIds, setSelectedIds] = useState([]),
    [bulkOpen, setBulkOpen] = useState(false),
    [bulkAssignee, setBulkAssignee] = useState(),
    [bulkReason, setBulkReason] = useState(""),
    [bulkBusy, setBulkBusy] = useState(false),
    [localReload, setLocalReload] = useState(0),
    bulkLock = useRef(false);
  useEffect(() => {
    let live = true;
    setData();
    setError("");
    Promise.all([
      listApplications(client, filters),
      manager ? listActiveAppliers(client) : Promise.resolve([]),
      manager ? listApplicationBatchOptions(client) : Promise.resolve([]),
    ])
      .then(([items, users, batchItems]) => {
        if (live) {
          setData(items);
          setAppliers(users);
          setBatches(batchItems);
        }
      })
      .catch((x) => live && setError(x.message));
    return () => {
      live = false;
    };
  }, [client, query, reload, manager, localReload]);
  const update = (patch) => {
    const text = serializeApplicationQuery({ ...filters, ...patch });
    go(`#/applications${text ? `?${text}` : ""}`);
  };
  const viewColumn = {
    title: "",
    key: "action",
    fixed: "right",
    render: (_, record) => (
      <Button type="link" href={`#/applications/${record.id}`}>
        View
      </Button>
    ),
  };
  const numberColumn = {
    title: "Application #",
    dataIndex: "application_number",
    sortKey: "number",
    render: (value) => <Text code>{value ?? "—"}</Text>,
  };
  const managerColumns = [
    numberColumn,
    { title: "Company", dataIndex: "company", sortKey: "company" },
    { title: "Job title", dataIndex: "job_title", sortKey: "title" },
    {
      title: "Resume",
      dataIndex: "resume_name",
      sortKey: "resume",
      render: (value, record) => (
        <div>
          <Text strong>{value || "Unnamed Resume"}</Text>
          {record.candidate_name && (
            <div>
              <Text type="secondary">{record.candidate_name}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Applier profile",
      dataIndex: "assignee_name",
      sortKey: "assignee",
      render: (value, record) => value || record.assignee_email || "Unassigned",
    },
    {
      title: "Work Status",
      dataIndex: "work_status",
      sortKey: "work",
      render: (value) => <StatusTag value={value} />,
    },
    {
      title: "Application Status",
      dataIndex: "application_status",
      sortKey: "application_status",
      render: (value) => <StatusTag value={value} />,
    },
    {
      title: "Priority",
      dataIndex: "priority",
      sortKey: "priority",
      render: (value) => <StatusTag value={value} />,
    },
    { title: "Due", dataIndex: "due_at", sortKey: "due", render: formatDate },
    {
      title: "Creation",
      dataIndex: "creation_batch_id",
      sortKey: "batch",
      render: (value, record) =>
        value ? (
          <a href={`#/application-batches/${value}`}>
            {record.creation_batch_name || `Batch ${String(value).slice(0, 8)}`}
          </a>
        ) : (
          "Individual"
        ),
    },
    {
      title: "Updated",
      dataIndex: "updated_at",
      sortKey: "updated",
      render: formatDate,
    },
    viewColumn,
  ];
  const applierColumns = [
    numberColumn,
    { title: "Company", dataIndex: "company", sortKey: "company" },
    { title: "Job title", dataIndex: "job_title", sortKey: "title" },
    {
      title: "Resume",
      dataIndex: "resume_name",
      sortKey: "resume",
      render: (value, record) => (
        <div>
          <Text strong>{value || "Unnamed Resume"}</Text>
          {record.candidate_name && (
            <div>
              <Text type="secondary">{record.candidate_name}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Link",
      key: "links",
      sortKey: "link",
      render: (_, record) => {
        const jobUrl = safeExternalUrl(record.source_url),
          applicationUrl = safeExternalUrl(record.application_url);
        return (
          <Space direction="vertical" size={0}>
            {jobUrl ? (
              <a href={jobUrl} target="_blank" rel="noopener noreferrer">
                Job posting
              </a>
            ) : (
              <Text type="secondary">No job link</Text>
            )}
            {applicationUrl && (
              <a
                href={applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Application
              </a>
            )}
          </Space>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "application_status",
      sortKey: "application_status",
      render: (value) => <StatusTag value={value} />,
    },
    {
      title: "Captured at",
      dataIndex: "captured_at",
      sortKey: "captured",
      render: formatDate,
    },
    {
      title: "Primary category",
      dataIndex: "category_name",
      sortKey: "category",
      render: (value) => value || "Uncategorized",
    },
    viewColumn,
  ];
  const columns = serverSortColumns(
      manager ? managerColumns : applierColumns,
      filters.sort,
    ),
    tooMany = selectedIds.length > 500;
  async function submitBulkAssignment() {
    if (bulkLock.current || bulkBusy || !bulkAssignee || !selectedIds.length)
      return;
    bulkLock.current = true;
    setBulkBusy(true);
    setError("");
    try {
      const assignee = bulkAssignee === "__UNASSIGN__" ? null : bulkAssignee,
        result = await bulkAssignApplications(
          client,
          selectedIds,
          assignee,
          bulkReason,
        );
      setNotice(
        `${result.changedCount} Application(s) changed; ${result.unchangedCount} unchanged; ${result.missingCount} missing.`,
      );
      setSelectedIds([]);
      setBulkOpen(false);
      setBulkAssignee();
      setBulkReason("");
      setLocalReload((value) => value + 1);
    } catch (cause) {
      setError(cause.message);
    } finally {
      bulkLock.current = false;
      setBulkBusy(false);
    }
  }
  return (
    <div className="page">
      <Flex justify="space-between" align="center" wrap>
        <Title level={1} tabIndex={-1}>
          Applications
        </Title>
        {manager && (
          <Space wrap>
            <Text>{selectedIds.length} selected</Text>
            <Button
              disabled={!selectedIds.length}
              onClick={() => setSelectedIds([])}
            >
              Clear selection
            </Button>
            <Button
              disabled={!selectedIds.length || tooMany}
              onClick={() => setBulkOpen(true)}
            >
              Assign Selected
            </Button>
            <Button type="primary" href="#/applications/new">
              Create Application
            </Button>
          </Space>
        )}
      </Flex>
      {notice && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setNotice("")}
          message={notice}
        />
      )}{" "}
      {tooMany && (
        <Alert
          type="error"
          showIcon
          message="Select no more than 500 Applications for one assignment."
        />
      )}
      <ApplicationFilters
        value={filters}
        manager={manager}
        appliers={appliers}
        batches={batches}
        categories={categories}
        onApply={update}
        onClear={() => go("#/applications")}
      />
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState text="Loading Applications…" />
      ) : !data.items.length ? (
        <Card>
          <Empty
            description={
              manager
                ? "No Applications match this view. Create one by pairing a job description and active resume."
                : "No Applications are currently assigned to you."
            }
          />
        </Card>
      ) : (
        <Card>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
            rowSelection={
              manager
                ? {
                    selectedRowKeys: selectedIds,
                    preserveSelectedRowKeys: true,
                    onChange: setSelectedIds,
                  }
                : undefined
            }
            onChange={(_pagination, _tableFilters, sorter) =>
              update({
                sort: serverSortFromTable(sorter, "updated_desc"),
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
            <Text>
              Showing {data.from}–{data.to} of {data.total}
            </Text>
            <Pagination
              current={data.page}
              pageSize={data.pageSize}
              total={data.total}
              showSizeChanger={false}
              onChange={(page) => update({ page })}
            />
          </Flex>
        </Card>
      )}
      <Modal
        open={bulkOpen}
        title={`Assign ${selectedIds.length} Applications`}
        okText={
          bulkAssignee === "__UNASSIGN__"
            ? "Unassign Applications"
            : "Assign Applications"
        }
        confirmLoading={bulkBusy}
        okButtonProps={{
          disabled: !selectedIds.length || tooMany || !bulkAssignee,
        }}
        onOk={submitBulkAssignment}
        onCancel={() => !bulkBusy && setBulkOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="Assignment action" required>
            <Select
              showSearch
              optionFilterProp="label"
              value={bulkAssignee}
              placeholder="Select an active Applier or unassign"
              onChange={setBulkAssignee}
              options={[
                {
                  value: "__UNASSIGN__",
                  label: "Unassign selected Applications",
                },
                ...appliers.map((applier) => ({
                  value: applier.id,
                  label: `${name(applier)} - ${applier.active_application_count} active`,
                })),
              ]}
            />
          </Form.Item>
          <Form.Item label="Assignment reason (optional)">
            <Input.TextArea
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              maxLength={2000}
              showCount
              rows={4}
            />
          </Form.Item>
          {bulkAssignee && (
            <Alert
              type="warning"
              showIcon
              message={
                bulkAssignee === "__UNASSIGN__"
                  ? "Every selected Application will return to the unassigned queue."
                  : "Every selected Application will be assigned to the same Applier."
              }
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}

export function CreateApplicationPage({ client }) {
  const [jobs, setJobs] = useState([]),
    [resumes, setResumes] = useState([]),
    [appliers, setAppliers] = useState([]),
    [jobId, setJobId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([listApplicationJobs(client), listActiveAppliers(client)])
      .then(([j, a]) => {
        if (live) {
          setJobs(j);
          setAppliers(a);
        }
      })
      .catch((x) => live && setMessage(x.message));
    return () => {
      live = false;
    };
  }, [client]);
  useEffect(() => {
    let live = true;
    if (!jobId) {
      setResumes([]);
      return;
    }
    listApplicationResumes(client, jobId)
      .then((x) => live && setResumes(x))
      .catch((x) => live && setMessage(x.message));
    return () => {
      live = false;
    };
  }, [client, jobId]);
  async function submit(raw) {
    setMessage("");
    setBusy(true);
    try {
      const created = await createApplication(client, {
        ...raw,
        dueAt: fromLocal(raw.dueAt),
      });
      go(`#/applications/${created.id}`);
    } catch (x) {
      setMessage(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page narrow-page">
      <Button type="link" href="#/applications">
        ← Back to Applications
      </Button>
      <Title level={1} tabIndex={-1}>
        Create Application
      </Title>
      <Text>
        Create one Application by pairing one job description with one active
        resume. Category ordering is informational and does not perform
        matching.
      </Text>
      <Notice message={message} error />
      <Card>
        <Form
          layout="vertical"
          initialValues={{ priority: "NORMAL", assignedTo: "" }}
          onFinish={submit}
        >
          <Form.Item
            label="Job Description"
            name="jobDescriptionId"
            rules={[{ required: true, message: "Select a job description." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              onChange={setJobId}
              options={jobs.map((x) => ({
                value: x.id,
                label: `${x.company} - ${x.job_title}${x.status !== "ACTIVE" ? ` (${formatLabel(x.status)})` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="Resume"
            name="resumeId"
            rules={[{ required: true, message: "Select an active resume." }]}
          >
            <Select
              disabled={!jobId}
              options={resumes.map((x) => ({
                value: x.id,
                label: `${x.same_category ? "Same category - " : ""}${x.candidate_name} - ${x.resume_name}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="Assigned Applier (optional)" name="assignedTo">
            <Select
              options={[
                { value: "", label: "Leave unassigned" },
                ...appliers.map((x) => ({
                  value: x.id,
                  label: `${name(x)} - ${x.active_application_count} active`,
                })),
              ]}
            />
          </Form.Item>
          <Form.Item label="Priority" name="priority">
            <Select
              options={APPLICATION_PRIORITIES.map((value) => ({
                value,
                label: formatLabel(value),
              }))}
            />
          </Form.Item>
          <Form.Item label="Due date and time (optional)" name="dueAt">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item label="Notes (optional)" name="notes">
            <Input.TextArea maxLength={10000} rows={5} showCount />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={busy}>
              Create Application
            </Button>
            <Button href="#/applications">Cancel</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}

function ProgressForm({ application, manager, onSave, busy }) {
  const initial = {
    workStatus: application.work_status,
    applicationStatus: application.application_status,
    applicationUrl: application.application_url || "",
    appliedAt: toLocal(application.applied_at),
    notes: application.notes || "",
    priority: application.priority,
    dueAt: toLocal(application.due_at),
  };
  return (
    <Form
      layout="vertical"
      key={application.updated_at || application.id}
      initialValues={initial}
      onFinish={(value) => {
        const progress = {
          workStatus: value.workStatus,
          applicationStatus: value.applicationStatus,
          applicationUrl: value.applicationUrl,
        };
        if (manager) {
          progress.appliedAt = fromLocal(value.appliedAt);
          progress.notes = value.notes;
          progress.priority = value.priority;
          progress.dueAt = fromLocal(value.dueAt);
        }
        onSave(progress);
      }}
    >
      <Form.Item label="Work Status" name="workStatus">
        <Select
          options={WORK_STATUSES.filter(
            (x) =>
              (x !== "UNASSIGNED" || !application.assigned_to) &&
              (manager || x !== "CANCELLED"),
          ).map((value) => ({ value, label: formatLabel(value) }))}
        />
      </Form.Item>
      <Form.Item label="Application Status" name="applicationStatus">
        <Select
          options={APPLICATION_STATUSES.map((value) => ({
            value,
            label: formatLabel(value),
          }))}
        />
      </Form.Item>
      <Form.Item
        label="Application URL"
        name="applicationUrl"
        rules={[
          { type: "url", warningOnly: true, message: "Enter a valid URL." },
        ]}
      >
        <Input type="url" maxLength={4000} placeholder="https://..." />
      </Form.Item>
      {manager && (
        <>
          <Form.Item label="Applied date and time" name="appliedAt">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item label="Priority" name="priority">
            <Select
              options={APPLICATION_PRIORITIES.map((value) => ({
                value,
                label: formatLabel(value),
              }))}
            />
          </Form.Item>
          <Form.Item label="Due date and time" name="dueAt">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item label="Notes" name="notes">
            <Input.TextArea maxLength={10000} rows={5} showCount />
          </Form.Item>
        </>
      )}
      <Button type="primary" htmlType="submit" loading={busy}>
        Save Progress
      </Button>
    </Form>
  );
}

export function ApplicationDetailPage({ client, access, id, reload }) {
  const { modal } = AntApp.useApp(),
    [detail, setDetail] = useState(),
    [appliers, setAppliers] = useState([]),
    [message, setMessage] = useState(""),
    [isError, setIsError] = useState(false),
    [busy, setBusy] = useState(false),
    manager = isApplicationManager(access);
  const load = () => {
    setDetail();
    setMessage("");
    Promise.all([
      getApplication(client, id),
      manager ? listActiveAppliers(client) : Promise.resolve([]),
    ])
      .then(([d, a]) => {
        setDetail(d);
        setAppliers(a);
      })
      .catch((x) => {
        setIsError(true);
        setMessage(x.message);
      });
  };
  useEffect(load, [client, id, reload, manager]);
  if (!detail)
    return (
      <div className="page">
        <Notice message={message} error={isError} />
        {!message && <LoadingState />}
      </div>
    );
  const a = detail.application,
    actions = applicationActions(access, a),
    job = detail.job,
    resume = detail.resume,
    source = safeExternalUrl(job.source_url),
    appUrl = safeExternalUrl(a.application_url);
  async function run(task, success) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setIsError(false);
      setMessage(success);
      setDetail(await getApplication(client, id));
    } catch (x) {
      setIsError(true);
      setMessage(x.message);
    } finally {
      setBusy(false);
    }
  }
  async function openResume() {
    setBusy(true);
    try {
      const url = await openApplicationResume(client, id);
      window.open(url, "_blank", "noopener,noreferrer");
      setIsError(false);
      setMessage("A short-lived private Resume link was opened.");
    } catch (x) {
      setIsError(true);
      setMessage(x.message);
    } finally {
      setBusy(false);
    }
  }
  const assignmentColumns = [
      { title: "When", dataIndex: "created_at", render: formatDate },
      {
        title: "Previous",
        dataIndex: "previous_assignee",
        render: (value) => value || "Unassigned",
      },
      {
        title: "New",
        dataIndex: "new_assignee",
        render: (value) => value || "Unassigned",
      },
      { title: "Changed by", dataIndex: "assigned_by" },
      { title: "Reason", dataIndex: "reason", render: (value) => value || "—" },
    ],
    statusColumns = [
      { title: "When", dataIndex: "created_at", render: formatDate },
      { title: "Type", dataIndex: "status_type", render: formatLabel },
      { title: "Previous", dataIndex: "previous_status", render: formatLabel },
      { title: "New", dataIndex: "new_status", render: formatLabel },
      { title: "Changed by", dataIndex: "changed_by" },
      { title: "Notes", dataIndex: "notes", render: (value) => value || "—" },
    ];
  return (
    <div className="page">
      <Button type="link" href="#/applications">
        ← Back to Applications
      </Button>
      <Flex justify="space-between" align="center" wrap>
        <div>
          <Text type="secondary" className="eyebrow">
            Application #{a.application_number ?? "—"} · {job.company}
          </Text>
          <Title level={1} tabIndex={-1}>
            {job.job_title}
          </Title>
        </div>
        <StatusTag value={a.priority} />
      </Flex>
      <Notice message={message} error={isError} />
      <TabbedSections
        items={[
          {
            key: "overview",
            label: "Overview",
            children: (
              <>
                <Card
                  title="Summary"
                  extra={
                    appUrl ? (
                      <Button
                        type="link"
                        href={appUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Application URL
                      </Button>
                    ) : null
                  }
                >
                  <Descriptions
                    bordered
                    column={{ xs: 1, md: 2 }}
                    items={[
                      {
                        key: "number",
                        label: "Application number",
                        children: (
                          <Text code>{a.application_number ?? "—"}</Text>
                        ),
                      },
                      {
                        key: "assignee",
                        label: "Assigned Applier",
                        children: name(detail.assignee),
                      },
                      {
                        key: "work",
                        label: "Work Status",
                        children: <StatusTag value={a.work_status} />,
                      },
                      {
                        key: "application",
                        label: "Application Status",
                        children: <StatusTag value={a.application_status} />,
                      },
                      {
                        key: "priority",
                        label: "Priority",
                        children: formatLabel(a.priority),
                      },
                      {
                        key: "due",
                        label: "Due",
                        children: formatDate(a.due_at),
                      },
                      {
                        key: "applied",
                        label: "Applied",
                        children: formatDate(a.applied_at),
                      },
                      {
                        key: "creator",
                        label: "Created by",
                        children: name(detail.creator),
                      },
                      {
                        key: "created",
                        label: "Created",
                        children: formatDate(a.created_at),
                      },
                    ]}
                  />
                </Card>
                <Card
                  title="Job Description"
                  extra={
                    source ? (
                      <Button
                        type="link"
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open original posting
                      </Button>
                    ) : null
                  }
                >
                  <Text strong>
                    {job.company} - {job.job_title}
                  </Text>
                  <p>
                    {job.location_text || formatLabel(job.work_arrangement)}
                  </p>
                  <Collapse
                    ghost
                    items={[
                      {
                        key: "description",
                        label: "View description",
                        children: (
                          <div className="long-text">
                            {job.description_text}
                          </div>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="Resume">
                  <p>
                    <Text strong>{resume.candidate_name}</Text> -{" "}
                    {resume.resume_name}
                  </p>
                  <p>
                    {formatLabel(resume.seniority)} · {resume.original_filename}
                  </p>
                  <Button
                    onClick={openResume}
                    loading={busy}
                    disabled={!actions.canOpenResume}
                  >
                    Open Resume securely
                  </Button>
                </Card>
              </>
            ),
          },
          actions.canUpdate && {
            key: "progress",
            label: "Progress",
            children: (
              <Card title="Progress">
                <ProgressForm
                  application={a}
                  manager={manager}
                  busy={busy}
                  onSave={(value) =>
                    run(
                      () => updateApplication(client, id, value),
                      "Application progress was saved.",
                    )
                  }
                />
              </Card>
            ),
          },
          manager && {
            key: "assignment",
            label: "Assignment",
            children: (
              <Card title="Assignment">
                <Form
                  layout="vertical"
                  initialValues={{ assignee: a.assigned_to || "", reason: "" }}
                  onFinish={(raw) => {
                    const next = raw.assignee || null;
                    modal.confirm({
                      title: next
                        ? "Reassign this Application?"
                        : "Unassign this Application?",
                      content: next
                        ? "The selected Applier will receive this Application."
                        : "The Application will return to the unassigned queue.",
                      onOk: () =>
                        run(
                          () =>
                            reassignApplication(client, id, next, raw.reason),
                          next
                            ? "Application was reassigned."
                            : "Application was unassigned.",
                        ),
                    });
                  }}
                >
                  <Form.Item label="Active Applier" name="assignee">
                    <Select
                      options={[
                        { value: "", label: "Unassigned" },
                        ...appliers.map((x) => ({
                          value: x.id,
                          label: `${name(x)} - ${x.active_application_count} active`,
                        })),
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Reason" name="reason">
                    <Input maxLength={2000} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={busy}>
                    Save Assignment
                  </Button>
                </Form>
                {a.work_status !== "CANCELLED" && (
                  <Button
                    danger
                    loading={busy}
                    onClick={() =>
                      modal.confirm({
                        title: "Cancel this Application?",
                        content: "The record and history will be retained.",
                        okText: "Cancel Application",
                        okButtonProps: { danger: true },
                        onOk: () =>
                          run(
                            () =>
                              updateApplication(client, id, {
                                workStatus: "CANCELLED",
                                applicationStatus: a.application_status,
                                applicationUrl: a.application_url,
                                appliedAt: a.applied_at,
                                notes: a.notes,
                                priority: a.priority,
                                dueAt: a.due_at,
                              }),
                            "Application was cancelled.",
                          ),
                      })
                    }
                  >
                    Cancel Application
                  </Button>
                )}
              </Card>
            ),
          },
          {
            key: "history",
            label: "History",
            children: (
              <>
                <Card title="Assignment History">
                  {detail.assignment_history.length ? (
                    <Table
                      rowKey="id"
                      columns={assignmentColumns}
                      dataSource={detail.assignment_history}
                      pagination={false}
                      scroll={{ x: "max-content" }}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No assignment changes recorded."
                    />
                  )}
                </Card>
                <Card title="Status History">
                  {detail.status_history.length ? (
                    <Table
                      rowKey="id"
                      columns={statusColumns}
                      dataSource={detail.status_history}
                      pagination={false}
                      scroll={{ x: "max-content" }}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No status changes recorded."
                    />
                  )}
                </Card>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
