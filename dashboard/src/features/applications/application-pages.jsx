import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Row,
  Select,
  Space,
  Statistic,
  Table as AntTable,
  Tag,
  Typography,
} from "antd";
import { FileImageOutlined } from "@ant-design/icons";
import { formatDate, formatLabel } from "../../shared/formatters.js";
import { safeExternalUrl } from "../../shared/url.js";
import { clientSortColumns } from "../../shared/table-sorting.js";
import {
  firstFilterValue,
  pickSharedColumnSearch,
  searchFilterIcon,
  serverSideColumnFilter,
  textSearchFilterDropdown,
} from "../../shared/column-filters.jsx";
import { useTableBodyHeight } from "../../shared/use-table-body-height.js";
import {
  ErrorState,
  EllipsisCell,
  LoadingState,
  MetaTag,
  StatusTag,
  TabbedSections,
  DataPagination,
  categoryTagColor,
} from "../../components/ui.jsx";
import {
  APPLICATION_PRIORITIES,
  APPLICATION_STATUSES,
} from "./constants.js";
import { applicationActions, isApplicationManager } from "./validation.js";
import {
  parseApplicationQuery,
  serializeApplicationQuery,
} from "./query-state.js";
import {
  createApplication,
  bulkCancelApplications,
  getApplication,
  getApplicationCounts,
  listActiveAppliers,
  listApplicationJobs,
  listApplicationResumes,
  listApplications,
  openApplicationResume,
  openFirstApplicationScreenshot,
  reassignApplication,
  updateApplication,
} from "./application-service.js";
import { ApplicationScreenshotsCard } from "./application-screenshots-card.jsx";
import { listApplicationBatchOptions } from "../bulk-applications/bulk-service.js";
import { storeAssignmentIds } from "../bulk-assignment/bulk-assignment-service.js";
import { createTailoringBatch,requestApplicationTailoring } from "../tailoring/tailoring-service.js";

const { Text, Title } = Typography,
  Table = (props) => (
    <AntTable {...props} columns={clientSortColumns(props.columns)} />
  ),
  go = (hash) => location.assign(hash),
  toLocal = (value) =>
    value ? new Date(value).toISOString().slice(0, 16) : "",
  fromLocal = (value) => (value ? new Date(value).toISOString() : null),
  name = (user) => user?.display_name || user?.email || "Unassigned",
  PAGE_SIZES = [25, 50, 100, 500, 1000, 5000],
  UNASSIGNED_APPLIER_ID = "00000000-0000-4000-8000-000000000000",
  FINAL_TAILORING_STATUSES = new Set(["APPROVED", "MATERIALIZING", "COMPLETED"]),
  tailoringIsFinal = (record) => FINAL_TAILORING_STATUSES.has(record?.tailoring_status);
const Notice = ({ message, error = false }) =>
  message ? (
    <Alert
      className="ui-alert"
      type={error ? "error" : "success"}
      showIcon
      message={message}
    />
  ) : null;

export function ApplicationsPage({
  client,
  apiBaseUrl,
  access,
  categories,
  query,
  reload,
}) {
  const manager = isApplicationManager(access),
    filters = parseApplicationQuery(query),
    filterKey = JSON.stringify(filters),
    [data, setData] = useState(),
    [appliers, setAppliers] = useState([]),
    [batches, setBatches] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selectedIds, setSelectedIds] = useState([]),
    [selectionMode,setSelectionMode]=useState("TAILOR"),
    [tailoringBusy,setTailoringBusy]=useState(false),
    [cancelBusy,setCancelBusy]=useState(false),
    [localReload, setLocalReload] = useState(0),
    [openingScreenshotId, setOpeningScreenshotId] = useState(""),
    requestId = useRef(0),
    [tableHostRef, tableBodyHeight] = useTableBodyHeight(Boolean(data));
  useEffect(() => {
    const id = ++requestId.current;
    setData();
    setError("");
    Promise.all([
      listApplications(client, apiBaseUrl, filters),
      manager ? listActiveAppliers(client, apiBaseUrl) : Promise.resolve([]),
      manager ? listApplicationBatchOptions(client, apiBaseUrl) : Promise.resolve([]),
    ])
      .then(([items, users, batchItems]) => {
        if (id !== requestId.current) return;
        setData(items);
        setAppliers(users);
        setBatches(batchItems);
      })
      .catch((x) => {
        if (id === requestId.current) setError(x.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, filterKey, reload, manager, localReload]);
  const update = (patch) => {
    const text = serializeApplicationQuery({ ...filters, ...patch });
    go(`#/applications${text ? `?${text}` : ""}`);
  };
  async function openScreenshot(record) {
    if (openingScreenshotId) return;
    setOpeningScreenshotId(record.id);
    setError("");
    try {
      await openFirstApplicationScreenshot(client, apiBaseUrl, record.id);
    } catch (x) {
      setError(x.message);
    } finally {
      setOpeningScreenshotId("");
    }
  }
  const searchFiltered = filters.search ? [filters.search] : null;
  const searchPlaceholder = "Application #, company, or job title";
  const sharedSearchKeys = ["application_number", "company", "job_title"];
  const actionColumn = {
    title: "Actions",
    key: "action",
    width: 88,
    fixed: "right",
    sortable: false,
    render: (_, record) => <Button type="link" href={`#/applications/${record.id}`}>View</Button>,
  };
  const noColumn = {
    title: "No",
    key: "no",
    width: 64,
    sortable: false,
    render: (_value, _row, index) =>
      ((filters.page || 1) - 1) * (filters.pageSize || 25) + index + 1,
  };
  const numberColumn = {
    title: "Application #",
    dataIndex: "application_number",
    sortKey: "number",
    width: 148,
    filteredValue: searchFiltered,
    ...serverSideColumnFilter,
    filterDropdown: textSearchFilterDropdown(searchPlaceholder),
    filterIcon: searchFilterIcon,
    render: (value) => <Text code>{value ?? "—"}</Text>,
  };
  const companyColumn = {
    title: "Company",
    dataIndex: "company",
    sortKey: "company",
    width: 160,
    filteredValue: searchFiltered,
    ...serverSideColumnFilter,
    filterDropdown: textSearchFilterDropdown(searchPlaceholder),
    filterIcon: searchFilterIcon,
    render: (value) => <EllipsisCell>{value}</EllipsisCell>,
  };
  const jobTitleColumn = {
    title: "Job Title",
    dataIndex: "job_title",
    sortKey: "title",
    width: 200,
    filteredValue: searchFiltered,
    ...serverSideColumnFilter,
    filterDropdown: textSearchFilterDropdown(searchPlaceholder),
    filterIcon: searchFilterIcon,
    render: (value) => <EllipsisCell>{value}</EllipsisCell>,
  };
  const profileNameColumn = {
    title: "Profile name",
    dataIndex: "candidate_name",
    sortKey: "candidate",
    width: 160,
    render: (value) => value || "—",
  };
  const resumeColumn = {
    title: "Resume",
    dataIndex: "resume_name",
    sortKey: "resume",
    width: 200,
    render: (value) => value || "Unnamed Resume",
  };
  const statusColumn = {
    title: "Status",
    dataIndex: "status",
    sortKey: "status",
    width: 140,
    filters: APPLICATION_STATUSES.map((value) => ({
      text: formatLabel(value),
      value,
    })),
    filterMultiple: false,
    filteredValue: filters.status ? [filters.status] : null,
    ...serverSideColumnFilter,
    render: (value) => <StatusTag value={value} />,
  };
  const categoryColumn = {
    title: "Primary Category",
    dataIndex: "category_id",
    sortKey: "category",
    width: 200,
    filters: (categories?.primary || []).map((item) => ({
      text: item.name,
      value: item.id,
    })),
    filterMultiple: false,
    filteredValue: filters.categoryId ? [filters.categoryId] : null,
    ...serverSideColumnFilter,
    render: (value, record) => (
      <MetaTag color={categoryTagColor(categories, value)}>
        {record.category_name || "Uncategorized"}
      </MetaTag>
    ),
  };
  const screenshotColumn = {
    title: "Screenshots",
    dataIndex: "screenshot_count",
    width: 110,
    align: "center",
    sortable: false,
    render: (value, record) => {
      const count = Number(value) || 0;
      if (!count) return <Text type="secondary">—</Text>;
      const opening = openingScreenshotId === record.id;
      return (
        <Tag
          icon={<FileImageOutlined />}
          style={{ cursor: opening ? "wait" : "pointer" }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!opening) openScreenshot(record);
          }}
        >
          {opening ? "Opening…" : count}
        </Tag>
      );
    },
  };
  const managerColumns = useMemo(
    () => [
      noColumn,
      numberColumn,
      companyColumn,
      jobTitleColumn,
      profileNameColumn,
      resumeColumn,
      {
        title: "Applier",
        dataIndex: "assignee_name",
        sortKey: "assignee",
        width: 180,
        filters: [
          { text: "Unassigned", value: UNASSIGNED_APPLIER_ID },
          ...appliers.map((item) => ({
            text: name(item),
            value: item.id,
          })),
        ],
        filterMultiple: false,
        filteredValue: filters.assignedTo ? [filters.assignedTo] : null,
        ...serverSideColumnFilter,
        render: (value, record) => {
          const label = value || record.assignee_email || "Unassigned";
          const assigned = Boolean(record.assigned_to);
          return (
            <MetaTag
              color={assigned ? undefined : "default"}
              seed={assigned ? record.assigned_to : "unassigned"}
            >
              {label}
            </MetaTag>
          );
        },
      },
      statusColumn,
      categoryColumn,
      screenshotColumn,
      {
        title: "Creation",
        dataIndex: "creation_batch_id",
        sortKey: "batch",
        width: 168,
        filters: [
          { text: "Created In Bulk", value: "mode:BULK" },
          { text: "Created Individually", value: "mode:INDIVIDUAL" },
          ...batches.map((item) => ({
            text: item.name || `Batch ${String(item.id).slice(0, 8)}`,
            value: `batch:${item.id}`,
          })),
        ],
        filterMultiple: false,
        filteredValue: filters.creationBatchId
          ? [`batch:${filters.creationBatchId}`]
          : filters.creationMode
            ? [`mode:${filters.creationMode}`]
            : null,
        ...serverSideColumnFilter,
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
        title: "Captured At",
        dataIndex: "captured_at",
        sortKey: "captured",
        width: 190,
        render: formatDate,
      },
      {
        title: "Last Updated",
        dataIndex: "updated_at",
        sortKey: "updated",
        width: 190,
        render: formatDate,
      },
      actionColumn,
    ],
    // Column defs close over filters/appliers/batches; rebuild when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.page,
      filters.pageSize,
      filters.search,
      filters.assignedTo,
      filters.status,
      filters.priority,
      filters.categoryId,
      filters.creationBatchId,
      filters.creationMode,
      appliers,
      batches,
      categories,
      openingScreenshotId,
    ],
  );
  const applierColumns = useMemo(
    () => [
      noColumn,
      numberColumn,
      companyColumn,
      jobTitleColumn,
      profileNameColumn,
      resumeColumn,
      {
        title: "Link",
        key: "links",
        sortKey: "link",
        width: 140,
        render: (_, record) => {
          const jobUrl = safeExternalUrl(record.source_url),
            applicationUrl = safeExternalUrl(record.application_url);
          return (
            <Space orientation="vertical" size={0}>
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
        dataIndex: "status",
        sortKey: "status",
        width: 140,
        filters: APPLICATION_STATUSES.map((value) => ({
          text: formatLabel(value),
          value,
        })),
        filterMultiple: false,
        filteredValue: filters.status ? [filters.status] : null,
        ...serverSideColumnFilter,
        render: (value) => <StatusTag value={value} />,
      },
      screenshotColumn,
      {
        title: "Captured At",
        dataIndex: "captured_at",
        sortKey: "captured",
        width: 190,
        render: formatDate,
      },
      {
        title: "Last Updated",
        dataIndex: "updated_at",
        sortKey: "updated",
        width: 190,
        render: formatDate,
      },
      {
        title: "Primary Category",
        dataIndex: "category_id",
        sortKey: "category",
        width: 200,
        filters: (categories?.primary || []).map((item) => ({
          text: item.name,
          value: item.id,
        })),
        filterMultiple: false,
        filteredValue: filters.categoryId ? [filters.categoryId] : null,
        ...serverSideColumnFilter,
        render: (value, record) => (
          <MetaTag color={categoryTagColor(categories, value)}>
            {record.category_name || "Uncategorized"}
          </MetaTag>
        ),
      },
      actionColumn,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.page,
      filters.pageSize,
      filters.search,
      filters.status,
      filters.categoryId,
      categories,
      openingScreenshotId,
    ],
  );
  const columns = manager ? managerColumns : applierColumns,
    applicationsScrollX = manager ? 2386 : 2040,
    tooMany = selectedIds.length > 2000;
  async function tailorSelected(){setTailoringBusy(true);setError("");try{const batch=await createTailoringBatch(client,apiBaseUrl,selectedIds);setSelectedIds([]);go(`#/tailoring-batches/${batch.id}`);}catch(x){setError(x.message);}finally{setTailoringBusy(false);}}
  function cancelSelected(){
    Modal.confirm({
      title: `Cancel ${selectedIds.length} Application${selectedIds.length === 1 ? "" : "s"}?`,
      content: "Cancelled applications are removed from active work but the record and history are retained.",
      okText: "Cancel Applications",
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelBusy(true);
        setError("");
        try {
          const result = await bulkCancelApplications(client, apiBaseUrl, {
            applicationIds: selectedIds,
          });
          setSelectedIds([]);
          setLocalReload((value) => value + 1);
          setNotice(
            result.failed
              ? `Cancelled ${result.succeeded} of ${result.total} Applications. ${result.failed} could not be cancelled.`
              : `Cancelled ${result.succeeded} Application${result.succeeded === 1 ? "" : "s"}.`,
          );
        } catch (x) {
          setError(x.message);
          throw x;
        } finally {
          setCancelBusy(false);
        }
      },
    });
  }
  function applyTableFilters(tableFilters) {
    let search = filters.search;
    try {
      search = pickSharedColumnSearch(
        tableFilters,
        sharedSearchKeys,
        filters.search,
      ).trim().slice(0, 100);
    } catch {
      search = filters.search;
    }
    const creationRaw = firstFilterValue(tableFilters, "creation_batch_id", "");
    let creationMode = "",
      creationBatchId = "";
    if (creationRaw.startsWith("mode:")) {
      creationMode = creationRaw.slice(5);
    } else if (creationRaw.startsWith("batch:")) {
      creationBatchId = creationRaw.slice(6);
    }
    update({
      search,
      assignedTo: manager
        ? firstFilterValue(tableFilters, "assignee_name", "")
        : filters.assignedTo,
      status: firstFilterValue(tableFilters, "status", ""),
      priority: firstFilterValue(tableFilters, "priority", ""),
      company: "",
      categoryId: firstFilterValue(tableFilters, "category_id", ""),
      dueFilter: firstFilterValue(tableFilters, "due_at", ""),
      creationMode: manager ? creationMode : "",
      creationBatchId: manager ? creationBatchId : "",
      page: 1,
    });
  }
  return (
    <div className="page page-list">
      {manager ? (
        <Flex className="page-toolbar" justify="flex-end" align="center" wrap>
          <Space wrap>
            <Select value={selectionMode} onChange={value=>{setSelectionMode(value);setSelectedIds([]);}} options={[{value:"TAILOR",label:"Select For Tailoring"},{value:"ASSIGN",label:"Select For Assignment / Reassignment"},{value:"CANCEL",label:"Select For Cancellation"}]} style={{minWidth:220}}/>
            <Text>{selectedIds.length} selected</Text>
            <Button
              disabled={!selectedIds.length}
              onClick={() => setSelectedIds([])}
            >
              Clear selection
            </Button>
            <Button
              danger
              disabled={!selectedIds.length || cancelBusy}
              loading={cancelBusy}
              onClick={cancelSelected}
            >
              Cancel Selected
            </Button>
            <Button
              disabled={selectionMode!=="ASSIGN"||!selectedIds.length || tooMany}
              href="#/applications/bulk-assign"
              onClick={() => storeAssignmentIds(selectedIds)}
            >
              Assign / Reassign Selected
            </Button>
            <Button disabled={selectionMode!=="TAILOR"||!selectedIds.length||selectedIds.length>500} loading={tailoringBusy} onClick={tailorSelected}>Tailor Selected</Button>
            <Button type="primary" href="#/applications/new">
              Create Application
            </Button>
          </Space>
        </Flex>
      ) : null}
      {notice && (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setNotice("")}
          message={notice}
        />
      )}
      {tooMany && (
        <Alert
          type="error"
          showIcon
          message="Select no more than 2,000 Applications for one assignment."
        />
      )}
      {error && !data ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState text="Loading Applications…" />
      ) : (
        <Card className="page-list-card">
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 12 }}
            />
          )}
          <div ref={tableHostRef} className="page-list-table-host">
            <Table
              className="dashboard-ellipsis-table"
              rowKey="id"
              columns={columns}
              dataSource={data.items}
              pagination={false}
              tableLayout="fixed"
              scroll={{ x: applicationsScrollX, y: tableBodyHeight }}
              locale={{
                emptyText: (
                  <Space direction="vertical" size="small" style={{ padding: 24 }}>
                    <Text strong>No Applications</Text>
                    <Text type="secondary">
                      {manager
                        ? "No Applications match this view. Create one by pairing a job description and active resume."
                        : "No Applications match the current filters."}
                    </Text>
                    <Button onClick={() => go("#/applications")}>Clear filters</Button>
                  </Space>
                ),
              }}
              onChange={(_pagination, tableFilters, _sorter, extra) => {
                if (extra?.action && extra.action !== "filter") return;
                applyTableFilters(tableFilters);
              }}
              rowSelection={
                manager
                  ? {
                      columnWidth: 48,
                      fixed: true,
                      selectedRowKeys: selectedIds,
                      preserveSelectedRowKeys: true,
                      onChange: setSelectedIds,
                      getCheckboxProps: (record) => ({
                        disabled:
                          (selectionMode === "ASSIGN" &&
                            ["CANCELLED", "CLOSED", "COMPLETED"].includes(record.status)) ||
                          (selectionMode === "CANCEL" && record.status === "CANCELLED"),
                      }),
                    }
                  : undefined
              }
            />
          </div>
          <DataPagination
            data={data}
            pageSizeOptions={PAGE_SIZES}
            onPage={(page, pageSize) => {
              const nextSize = pageSize || filters.pageSize;
              update({
                page: nextSize !== filters.pageSize ? 1 : page,
                pageSize: nextSize,
              });
            }}
          />
        </Card>
      )}
    </div>
  );
}

export function CreateApplicationPage({ client, apiBaseUrl }) {
  const [jobs, setJobs] = useState([]),
    [resumes, setResumes] = useState([]),
    [appliers, setAppliers] = useState([]),
    [jobId, setJobId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([listApplicationJobs(client, apiBaseUrl), listActiveAppliers(client, apiBaseUrl)])
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
  }, [client, apiBaseUrl]);
  useEffect(() => {
    let live = true;
    if (!jobId) {
      setResumes([]);
      return;
    }
    listApplicationResumes(client, apiBaseUrl, jobId)
      .then((x) => live && setResumes(x))
      .catch((x) => live && setMessage(x.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, jobId]);
  async function submit(raw) {
    setMessage("");
    setBusy(true);
    try {
      const created = await createApplication(client, apiBaseUrl, {
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
                label: `${x.same_category ? "Same category - " : ""}${x.candidate_name} - ${x.resume_name}${x.resume_number ? ` #${x.resume_number}` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="Assigned Applier (optional)" name="assignedTo">
            <Select
              options={[
                { value: "", label: "Leave Unassigned" },
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
          <Form.Item label="Due Date And Time (Optional)" name="dueAt">
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
    status: application.status,
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
          status: value.status,
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
      <Form.Item label="Status" name="status">
        <Select
          options={APPLICATION_STATUSES.filter(
            (x) =>
              (x !== "UNASSIGNED" || !application.assigned_to) &&
              (manager || x !== "CANCELLED"),
          ).map((value) => ({ value, label: formatLabel(value) }))}
        />
      </Form.Item>
      <Form.Item
        label="Confirmation URL"
        name="applicationUrl"
        rules={[
          { type: "url", warningOnly: true, message: "Enter a valid URL." },
        ]}
      >
        <Input type="url" maxLength={4000} placeholder="https://..." />
      </Form.Item>
      {manager && (
        <>
          <Form.Item label="Applied Date And Time" name="appliedAt">
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
          <Form.Item label="Due Date And Time" name="dueAt">
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


export function ApplicationDetailPage({ client, apiBaseUrl, access, id, reload }) {
  const { modal } = AntApp.useApp(),
    [detail, setDetail] = useState(),
    [appliers, setAppliers] = useState([]),
    [screenshotCount, setScreenshotCount] = useState(null),
    [message, setMessage] = useState(""),
    [isError, setIsError] = useState(false),
    [busy, setBusy] = useState(false),
    manager = isApplicationManager(access);
  const load = () => {
    setDetail();
    setScreenshotCount(null);
    setMessage("");
    Promise.all([
      getApplication(client, apiBaseUrl, id),
      manager ? listActiveAppliers(client, apiBaseUrl) : Promise.resolve([]),
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
  useEffect(load, [client, apiBaseUrl, id, reload, manager]);
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
      setDetail(await getApplication(client, apiBaseUrl, id));
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
      const url = await openApplicationResume(client, apiBaseUrl, id);
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
  async function requestTailoring() {
    setBusy(true);
    setMessage("");
    try {
      const job = await requestApplicationTailoring(client, apiBaseUrl, id);
      go(`#/tailoring-jobs/${job.id}`);
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
      { title: "Changed By", dataIndex: "assigned_by" },
      { title: "Reason", dataIndex: "reason", render: (value) => value || "—" },
    ],
    statusColumns = [
      { title: "When", dataIndex: "created_at", render: formatDate },
      { title: "Type", dataIndex: "status_type", render: formatLabel },
      { title: "Previous", dataIndex: "previous_status", render: formatLabel },
      { title: "New", dataIndex: "new_status", render: formatLabel },
      { title: "Changed By", dataIndex: "changed_by" },
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
                        Open Confirmation URL
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
                        label: "Application Number",
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
                        key: "status",
                        label: "Status",
                        children: <StatusTag value={a.status} />,
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
                        key: "screenshots",
                        label: "Confirmation Screenshots",
                        children:
                          screenshotCount == null
                            ? "Loading…"
                            : screenshotCount
                              ? `${screenshotCount} attached`
                              : "None attached",
                      },
                      {
                        key: "creator",
                        label: "Created By",
                        children: name(detail.creator),
                      },
                      {
                        key: "created",
                        label: "Created",
                        children: formatDate(a.created_at),
                      },
                      {
                        key: "notes",
                        label: "Notes",
                        span: 2,
                        children: a.notes ? (
                          <Text className="long-text">{a.notes}</Text>
                        ) : (
                          "—"
                        ),
                      },
                    ]}
                  />
                </Card>
                <ApplicationScreenshotsCard
                  client={client}
                  apiBaseUrl={apiBaseUrl}
                  applicationId={id}
                  onCountChange={setScreenshotCount}
                />
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
                        label: "View Description",
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
                  <Space wrap>
                    <Button
                      onClick={openResume}
                      loading={busy}
                      disabled={!actions.canOpenResume}
                    >
                      Open Resume securely
                    </Button>
                    {manager&&<Button type="primary" onClick={requestTailoring} loading={busy}>Request or View Tailoring</Button>}
                  </Space>
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
                      () => updateApplication(client, apiBaseUrl, id, value),
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
                            reassignApplication(client, apiBaseUrl, id, next, raw.reason),
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
                  <Space wrap size="middle">
                    <Button type="primary" htmlType="submit" loading={busy}>
                      Save Assignment
                    </Button>
                    {a.status !== "CANCELLED" && (
                      <Button
                        danger
                        htmlType="button"
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
                                  updateApplication(client, apiBaseUrl, id, {
                                    status: "CANCELLED",
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
                  </Space>
                </Form>
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
