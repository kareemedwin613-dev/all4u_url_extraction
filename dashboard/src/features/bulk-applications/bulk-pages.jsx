import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Pagination,
  Result,
  Row,
  Select,
  Space,
  Statistic,
  Table as AntTable,
  Tag,
  Typography,
} from "antd";
import {
  ErrorState,
  FilterPanel,
  LoadingState,
  PageHeading,
  StatusTag,
  TabbedSections,
} from "../../components/ui.jsx";
import { formatDate, formatLabel } from "../../shared/formatters.js";
import { useDebouncedValue } from "../../shared/use-debounced-value.js";
import {
  clientSortColumns,
  serverSortColumns,
  serverSortFromTable,
} from "../../shared/table-sorting.js";
import {
  createBulkApplications,
  getApplicationBatch,
  listApplicationBatchResults,
  listApplicationBatches,
  previewBulkApplications,
} from "./bulk-service.js";
import {
  BULK_PAGE_SIZES,
  bulkConfirmationCounts,
  clearRows,
  creationPayload,
  defaultEligibleSelection,
  filterBulkCombinations,
  selectEligible,
} from "./bulk-state.js";

const { Text, Title } = Typography,
  Table = (props) => (
    <AntTable {...props} columns={clientSortColumns(props.columns)} />
  ),
  emptyFilters = {
    search: "",
    company: "",
    categoryId: "",
    candidate: "",
    resume: "",
    eligibility: "",
    exclusionCode: "",
  },
  go = (hash) => location.assign(hash);
const uniqueOptions = (rows, key) =>
  [...new Set(rows.map((row) => String(row[key] || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));

function PreviewSummary({ preview }) {
  const cards = [
    ["Selected JDs", preview.selectedJdCount],
    ["Valid JDs", preview.validJdCount],
    ["Active matching Resumes", preview.activeResumeCount],
    ["Proposed Applications", preview.proposedCount],
    ["Existing duplicates", preview.duplicateCount],
    ["Invalid or excluded", preview.excludedCount],
  ];
  return (
    <Row gutter={[12, 12]}>
      {cards.map(([label, value]) => (
        <Col xs={12} md={8} xl={4} key={label}>
          <Card size="small">
            <Statistic title={label} value={Number(value || 0)} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function PreviewFilters({ rows, value, onChange }) {
  const field = { xs: 24, sm: 12, lg: 6 },
    categories = [
      ...new Map(
        rows
          .filter((row) => row.jobCategoryId)
          .map((row) => [row.jobCategoryId, row.jobCategoryName]),
      ).entries(),
    ].map(([value, label]) => ({ value, label }));
  const activeCount = Object.values(value).filter(Boolean).length;
  return (
    <FilterPanel activeCount={activeCount}>
      <Row gutter={12}>
        <Col {...field}>
          <label>
            Search
            <Input.Search
              value={value.search}
              allowClear
              placeholder="Company, job, candidate, or Resume"
              onChange={(event) =>
                onChange({ ...value, search: event.target.value })
              }
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Company
            <Select
              value={value.company}
              onChange={(company) => onChange({ ...value, company })}
              options={[
                { value: "", label: "All companies" },
                ...uniqueOptions(rows, "company"),
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Category
            <Select
              value={value.categoryId}
              onChange={(categoryId) => onChange({ ...value, categoryId })}
              options={[{ value: "", label: "All categories" }, ...categories]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Candidate
            <Select
              showSearch
              value={value.candidate}
              onChange={(candidate) => onChange({ ...value, candidate })}
              options={[
                { value: "", label: "All candidates" },
                ...uniqueOptions(rows, "candidateName"),
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Resume
            <Select
              showSearch
              value={value.resume}
              onChange={(resume) => onChange({ ...value, resume })}
              options={[
                { value: "", label: "All Resumes" },
                ...uniqueOptions(rows, "resumeName"),
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Eligibility
            <Select
              value={value.eligibility}
              onChange={(eligibility) => onChange({ ...value, eligibility })}
              options={[
                { value: "", label: "All rows" },
                { value: "ELIGIBLE", label: "Eligible" },
                { value: "EXCLUDED", label: "Excluded" },
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Exclusion reason
            <Select
              value={value.exclusionCode}
              onChange={(exclusionCode) =>
                onChange({ ...value, exclusionCode })
              }
              options={[
                { value: "", label: "All reasons" },
                ...uniqueOptions(rows, "exclusionCode").map((option) => ({
                  ...option,
                  label: formatLabel(option.label),
                })),
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field} className="filter-actions">
          <Button onClick={() => onChange(emptyFilters)}>Clear filters</Button>
        </Col>
      </Row>
    </FilterPanel>
  );
}

function BulkResult({ result, onAnother }) {
  const warning = result.status === "COMPLETED_WITH_WARNINGS",
    failed = result.status === "FAILED",
    columns = clientSortColumns([
      {
        title: "Company",
        dataIndex: "company",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Job title",
        dataIndex: "jobTitle",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Resume",
        dataIndex: "resumeName",
        render: (value, row) => value || row.candidateName || "Unavailable",
      },
      {
        title: "Outcome",
        dataIndex: "outcome",
        render: (value) => <StatusTag value={value} />,
      },
      { title: "Reason", dataIndex: "message" },
    ]);
  return (
    <div className="page">
      <Result
        status={failed ? "error" : warning ? "warning" : "success"}
        title={
          failed
            ? "Bulk creation failed"
            : warning
              ? "Completed with warnings"
              : "Bulk creation completed"
        }
        subTitle={`Created ${result.createdCount}; duplicates ${result.duplicateCount}; skipped ${result.skippedCount}; failed ${result.failedCount}.`}
        extra={[
          <Button
            type="primary"
            key="apps"
            href={`#/applications?creationBatchId=${result.batchId}`}
          >
            View Created Applications
          </Button>,
          <Button key="batch" href={`#/application-batches/${result.batchId}`}>
            View Batch
          </Button>,
          <Button key="jobs" href="#/jobs">
            Back to Job Descriptions
          </Button>,
          <Button key="again" onClick={onAnother}>
            Create Another Batch
          </Button>,
        ]}
      />
      <Card title="Per-row outcomes">
        <Table
          rowKey="key"
          columns={columns}
          dataSource={result.results || []}
          pagination={{ pageSize: 25 }}
          scroll={{ x: "max-content", y: "calc(100vh - 390px)" }}
        />
      </Card>
    </div>
  );
}

export function BulkCreatePage({
  client,
  apiBaseUrl,
  selectedJobIds,
  onClearJobSelection,
}) {
  const { modal } = AntApp.useApp(),
    submitLock = useRef(false),
    idempotencyAttempt = useRef({ key: "", fingerprint: "" }),
    [preview, setPreview] = useState(),
    [selected, setSelected] = useState(new Set()),
    [filters, setFilters] = useState(emptyFilters),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [batchName, setBatchName] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [result, setResult] = useState();
  const ids = useMemo(
    () => [...new Set(selectedJobIds || [])],
    [selectedJobIds],
  );
  useEffect(() => {
    let live = true;
    if (!ids.length) return;
    setLoading(true);
    setError("");
    previewBulkApplications(client, apiBaseUrl, ids)
      .then((value) => {
        if (live) {
          setPreview(value);
          setSelected(defaultEligibleSelection(value));
        }
      })
      .catch((cause) => live && setError(cause.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, ids.join("|")]);
  const filtered = useMemo(
      () => filterBulkCombinations(preview?.combinations, filters),
      [preview, filters],
    ),
    visible = filtered.slice((page - 1) * pageSize, page * pageSize),
    counts = bulkConfirmationCounts(preview, selected);
  useEffect(() => setPage(1), [filters]);
  if (result)
    return (
      <BulkResult
        result={result}
        onAnother={() => {
          setResult();
          onClearJobSelection();
          go("#/jobs");
        }}
      />
    );
  if (!ids.length)
    return (
      <div className="page">
        <PageHeading title="Bulk Create Applications" />
        <Card>
          <Empty description="Select one or more Job Descriptions before opening the bulk preview.">
            <Button type="primary" href="#/jobs">
              Back to Job Descriptions
            </Button>
          </Empty>
        </Card>
      </div>
    );
  async function submit() {
    if (submitLock.current) return;
    const payload = creationPayload(preview, selected);
    if (!payload.length) {
      setError("Select at least one eligible combination.");
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({ payload, batchName: batchName.trim() });
      if (idempotencyAttempt.current.fingerprint !== fingerprint)
        idempotencyAttempt.current = { key: crypto.randomUUID(), fingerprint };
      const created = await createBulkApplications(client, apiBaseUrl, payload, batchName, idempotencyAttempt.current.key);
      idempotencyAttempt.current = { key: "", fingerprint: "" };
      setResult(created);
      onClearJobSelection();
    } catch (cause) {
      setError(cause.message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  function confirm() {
    if (!counts.applicationCount) {
      setError("Select at least one eligible combination.");
      return;
    }
    modal.confirm({
      title: `Create ${counts.applicationCount} Applications?`,
      width: 560,
      content: (
        <div>
          <p>
            Selected JDs: <strong>{counts.selectedJdCount}</strong>
          </p>
          <p>
            Selected Resumes: <strong>{counts.selectedResumeCount}</strong>
          </p>
          <p>
            Applications to create: <strong>{counts.applicationCount}</strong>
          </p>
          <p>
            Existing duplicates skipped:{" "}
            <strong>{counts.duplicateCount}</strong>
          </p>
          <p>
            Defaults:{" "}
            <strong>
              UNASSIGNED · NORMAL · No assigned Applier
            </strong>
          </p>
        </div>
      ),
      okText: `Create ${counts.applicationCount} Applications`,
      okButtonProps: { disabled: submitting },
      onOk: submit,
    });
  }
  const columns = clientSortColumns([
    { title: "Company", dataIndex: "company" },
    { title: "Job title", dataIndex: "jobTitle" },
    { title: "JD category", dataIndex: "jobCategoryName" },
    { title: "Candidate", dataIndex: "candidateName" },
    { title: "Resume", dataIndex: "resumeName" },
    { title: "Resume category", dataIndex: "resumeCategoryName" },
    {
      title: "Eligibility",
      dataIndex: "eligible",
      render: (value) =>
        value ? (
          <Tag color="green">Eligible</Tag>
        ) : (
          <Tag color="red">Excluded</Tag>
        ),
    },
    {
      title: "Exclusion reason",
      dataIndex: "exclusionReason",
      render: (value) => value || "—",
    },
  ]);
  return (
    <div className="page">
      <PageHeading
        title="Bulk Create Applications"
        eyebrow="Review JD–Resume combinations"
        extra={<Button href="#/jobs">Back to Job Descriptions</Button>}
      />
      {error && <Alert type="error" showIcon message={error} />}{" "}
      {loading ? (
        <LoadingState text="Generating secure bulk preview…" />
      ) : (
        preview && (
          <>
            <PreviewSummary preview={preview} />
            <TabbedSections
              items={[
                {
                  key: "combinations",
                  label: `Review combinations (${filtered.length})`,
                  children: (
                    <>
                      {preview.invalidJds?.length > 0 && (
                        <Card title="Invalid or skipped Job Descriptions">
                          <Alert
                            type="warning"
                            showIcon
                            message={`${preview.invalidJds.length} selected Job Description(s) cannot generate combinations.`}
                          />
                          <Table
                            rowKey="jobDescriptionId"
                            dataSource={preview.invalidJds}
                            pagination={false}
                            columns={[
                              { title: "Company", dataIndex: "company" },
                              { title: "Job title", dataIndex: "jobTitle" },
                              { title: "Reason", dataIndex: "reason" },
                            ]}
                            scroll={{ x: "max-content" }}
                          />
                        </Card>
                      )}
                      <PreviewFilters
                        rows={preview.combinations || []}
                        value={filters}
                        onChange={setFilters}
                      />
                      <Card
                        title={`${selected.size} combinations selected`}
                        extra={
                          <Space wrap>
                            <Button
                              onClick={() =>
                                setSelected(
                                  selectEligible(
                                    preview.combinations,
                                    new Set(),
                                  ),
                                )
                              }
                            >
                              Select all eligible
                            </Button>
                            <Button
                              onClick={() =>
                                setSelected((value) =>
                                  selectEligible(visible, value),
                                )
                              }
                            >
                              Select visible eligible
                            </Button>
                            <Button
                              onClick={() =>
                                setSelected((value) =>
                                  clearRows(visible, value),
                                )
                              }
                            >
                              Clear visible selection
                            </Button>
                            <Button onClick={() => setSelected(new Set())}>
                              Clear all selection
                            </Button>
                          </Space>
                        }
                      >
                        <Table
                          rowKey="key"
                          columns={columns}
                          dataSource={visible}
                          pagination={false}
                          rowSelection={{
                            selectedRowKeys: [...selected],
                            preserveSelectedRowKeys: true,
                            getCheckboxProps: (row) => ({
                              disabled: !row.eligible,
                            }),
                            onSelect: (row, checked) =>
                              setSelected((value) =>
                                checked
                                  ? selectEligible([row], value)
                                  : clearRows([row], value),
                              ),
                          }}
                          scroll={{ x: "max-content" }}
                        />
                        <Flex
                          justify="space-between"
                          align="center"
                          wrap
                          style={{ marginTop: 16 }}
                        >
                          <Text>
                            Showing{" "}
                            {filtered.length ? (page - 1) * pageSize + 1 : 0}–
                            {Math.min(page * pageSize, filtered.length)} of{" "}
                            {filtered.length}
                          </Text>
                          <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filtered.length}
                            showSizeChanger
                            pageSizeOptions={BULK_PAGE_SIZES}
                            onChange={(next, size) => {
                              setPage(next);
                              setPageSize(size);
                            }}
                          />
                        </Flex>
                      </Card>
                    </>
                  ),
                },
                {
                  key: "create",
                  label: `Create selected (${selected.size})`,
                  children: (
                    <Card title="Create selected Applications">
                      <Form layout="vertical">
                        <Form.Item
                          label="Batch name (optional)"
                          extra="Maximum 120 characters. A timestamped name is generated when blank."
                        >
                          <Input
                            value={batchName}
                            onChange={(event) =>
                              setBatchName(event.target.value)
                            }
                            maxLength={120}
                            showCount
                          />
                        </Form.Item>
                        <Button
                          type="primary"
                          disabled={!selected.size || submitting}
                          loading={submitting}
                          onClick={confirm}
                        >
                          Create Applications
                        </Button>
                      </Form>
                    </Card>
                  ),
                },
              ]}
            />
          </>
        )
      )}
    </div>
  );
}

export function ApplicationBatchesPage({ client, apiBaseUrl, query, reload }) {
  const params = new URLSearchParams(query),
    [searchInput, setSearchInput] = useState(params.get("search") || ""),
    search = useDebouncedValue(searchInput, 300),
    searchRef = useRef(search),
    [status, setStatus] = useState(params.get("status") || ""),
    [sort, setSort] = useState(params.get("sort") || "created_desc"),
    [page, setPage] = useState(Math.max(1, Number(params.get("page")) || 1)),
    [data, setData] = useState(),
    [error, setError] = useState("");
  useEffect(() => {
    if (searchRef.current !== search) {
      searchRef.current = search;
      setPage(1);
    }
  }, [search]);
  useEffect(() => {
    let live = true;
    setData();
    setError("");
    listApplicationBatches(client, apiBaseUrl, { search, status, sort, page, pageSize: 25 })
      .then((value) => live && setData(value))
      .catch((cause) => live && setError(cause.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, search, status, sort, page, reload]);
  const columns = serverSortColumns(
    [
      {
        title: "Batch name",
        dataIndex: "name",
        sortKey: "name",
        render: (value, row) => (
          <a href={`#/application-batches/${row.id}`}>{value}</a>
        ),
      },
      { title: "Created by", dataIndex: "creatorName", sortKey: "creator" },
      {
        title: "Created at",
        dataIndex: "createdAt",
        sortKey: "created",
        render: formatDate,
      },
      {
        title: "Selected JDs",
        dataIndex: "selectedJdCount",
        sortKey: "selected",
      },
      {
        title: "Requested",
        dataIndex: "requestedCount",
        sortKey: "requested",
      },
      {
        title: "Created Applications",
        dataIndex: "createdCount",
        sortKey: "created_count",
      },
      {
        title: "Duplicates",
        dataIndex: "duplicateCount",
        sortKey: "duplicate",
      },
      { title: "Skipped", dataIndex: "skippedCount", sortKey: "skipped" },
      { title: "Failed", dataIndex: "failedCount", sortKey: "failed" },
      {
        title: "Status",
        dataIndex: "status",
        sortKey: "status",
        render: (value) => <StatusTag value={value} />,
      },
    ],
    sort,
  );
  return (
    <div className="page">
      <PageHeading title="Application Batches" />
      <FilterPanel activeCount={[search, status].filter(Boolean).length}>
        <Space wrap>
          <Input.Search
            value={searchInput}
            allowClear
            placeholder="Search batch name"
            onChange={(event) => setSearchInput(event.target.value)}
            style={{ width: 280 }}
          />
          <Select
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 240 }}
            options={[
              { value: "", label: "All statuses" },
              ...[
                "PROCESSING",
                "COMPLETED",
                "COMPLETED_WITH_WARNINGS",
                "FAILED",
              ].map((value) => ({ value, label: formatLabel(value) })),
            ]}
          />
        </Space>
      </FilterPanel>
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState />
      ) : !data.items.length ? (
        <Card>
          <Empty description="No Application creation batches found." />
        </Card>
      ) : (
        <Card>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 390px)" }}
            onChange={(_pagination, _filters, sorter) => {
              setSort(serverSortFromTable(sorter, "created_desc"));
              setPage(1);
            }}
          />
          <Pagination
            current={data.page}
            pageSize={data.pageSize}
            total={data.total}
            showSizeChanger={false}
            onChange={setPage}
          />
        </Card>
      )}
    </div>
  );
}

export function ApplicationBatchDetailPage({ client, apiBaseUrl, id, reload }) {
  const [detail, setDetail] = useState(),
    [results, setResults] = useState(),
    [resultPage, setResultPage] = useState(1),
    [outcome, setOutcome] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    getApplicationBatch(client, apiBaseUrl, id)
      .then((value) => live && setDetail(value))
      .catch((cause) => live && setError(cause.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, id, reload]);
  useEffect(() => {
    let live = true;
    setResults();
    listApplicationBatchResults(client, apiBaseUrl, id, { page: resultPage, limit: 25, outcome })
      .then((value) => live && setResults(value))
      .catch((cause) => live && setError(cause.message));
    return () => { live = false; };
  }, [client, apiBaseUrl, id, resultPage, outcome, reload]);
  if (error)
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  if (!detail) return <LoadingState />;
  const batch = detail,
    columns = [
      {
        title: "Company",
        dataIndex: "company",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Job title",
        dataIndex: "jobTitle",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Candidate",
        dataIndex: "candidateName",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Resume",
        dataIndex: "resumeName",
        render: (value) => value || "Unavailable",
      },
      {
        title: "Outcome",
        dataIndex: "outcome",
        render: (value) => <StatusTag value={value} />,
      },
      { title: "Reason", dataIndex: "message" },
      {
        title: "Application",
        dataIndex: "applicationId",
        render: (value) =>
          value ? <a href={`#/applications/${value}`}>Open</a> : "—",
      },
    ],
    stats = [
      ["Selected JDs", batch.selectedJdCount],
      ["Requested", batch.requestedCount],
      ["Created", batch.createdCount],
      ["Duplicates", batch.duplicateCount],
      ["Skipped", batch.skippedCount],
      ["Failed", batch.failedCount],
    ],
    tabs = [
      {
        key: "summary",
        label: "Summary",
        children: (
          <>
            <Row gutter={[12, 12]}>
              {stats.map(([label, value]) => (
                <Col xs={12} md={8} xl={4} key={label}>
                  <Card size="small">
                    <Statistic title={label} value={value} />
                  </Card>
                </Col>
              ))}
            </Row>
            <p>
              Created by: <strong>{batch.creatorName}</strong>
            </p>
            <p>
              Started: {formatDate(batch.createdAt)} · Completed:{" "}
              {formatDate(batch.completedAt)}
            </p>
          </>
        ),
      },
      {
        key: "outcomes",
        label: `Outcomes (${results?.total ?? batch.requestedCount})`,
        children: (
          <>
            <FilterPanel activeCount={outcome ? 1 : 0}>
              <Select
                value={outcome}
                style={{ width: 240 }}
                onChange={(value) => { setOutcome(value); setResultPage(1); }}
                options={[{ value: "", label: "All outcomes" }, ...["CREATED", "DUPLICATE", "SKIPPED", "FAILED"].map((value) => ({ value, label: formatLabel(value) }))]}
              />
            </FilterPanel>
            {!results ? <LoadingState /> : (
              <>
                <Table rowKey="id" columns={columns} dataSource={results.items} pagination={false} scroll={{ x: "max-content", y: "calc(100vh - 500px)" }} />
                <Pagination current={results.page} pageSize={results.pageSize} total={results.total} showSizeChanger={false} onChange={setResultPage} />
              </>
            )}
          </>
        ),
      },
    ];
  return (
    <div className="page">
      <Button type="link" href="#/application-batches">
        ← Back to Application Batches
      </Button>
      <PageHeading
        title={batch.name}
        eyebrow="Bulk Application creation batch"
        extra={<StatusTag value={batch.status} />}
      />
      <TabbedSections
        items={tabs}
        extra={
          <Button
            type="primary"
            href={`#/applications?creationBatchId=${batch.id}`}
          >
            View Created Applications
          </Button>
        }
      />
    </div>
  );
}
