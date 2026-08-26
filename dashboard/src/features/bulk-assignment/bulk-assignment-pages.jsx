import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Flex, Form, Input,
  InputNumber, Modal, Result, Row, Space, Statistic, Steps, Switch,
  Table as AntTable, Tag, Typography,
} from "antd";
import { ErrorState, LoadingState, StatusTag } from "../../components/ui.jsx";
import { formatDate } from "../../shared/formatters.js";
import { clientSortColumns } from "../../shared/table-sorting.js";
import {
  appliersApi, assignmentBatchesApi, bulkAssignmentApi, parseAssignmentIds,
} from "./bulk-assignment-service.js";

const { Title, Text } = Typography;
const Table = (props) => <AntTable {...props} columns={clientSortColumns(props.columns)} />;
const newKey = () => `assign-${crypto.randomUUID()}`;

export function BulkAssignmentWizardPage({ client, apiBaseUrl, query }) {
  const ids = useMemo(() => parseAssignmentIds(query), [query]);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState();
  const [proposals, setProposals] = useState([]);
  const [result, setResult] = useState();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [batchName, setBatchName] = useState("");
  const keyRef = useRef();

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const data = await bulkAssignmentApi.preview(client, apiBaseUrl, {
        strategy: "PROFILE",
        applicationIds: ids,
      });
      setPreview(data);
      setProposals(data.proposals || []);
      keyRef.current = undefined;
      setStep(1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!proposals.length || busy) return;
    setBusy(true);
    setError("");
    try {
      keyRef.current ||= newKey();
      const data = await bulkAssignmentApi.assign(client, apiBaseUrl, {
        batchName: batchName || undefined,
        strategy: "PROFILE",
        assignments: proposals.map((proposal) => ({
          applicationId: proposal.applicationId,
          assignedTo: proposal.proposedAssigneeId,
        })),
      }, keyRef.current);
      setResult(data);
      setConfirm(false);
      setStep(2);
    } catch (failure) {
      setError(failure.message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const proposalColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value.slice(0, 8)}</Text> },
    { title: "Company", dataIndex: "company" },
    { title: "Job Title", dataIndex: "jobTitle" },
    { title: "Candidate", dataIndex: "candidateName" },
    { title: "Resume", dataIndex: "resumeName" },
    { title: "Proposed Applier", dataIndex: "proposedAssigneeName" },
  ];
  const exclusionColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value?.slice(0, 8) || "—"}</Text> },
    { title: "Code", dataIndex: "code", render: (value) => <Tag color={value === "RESUME_PROFILE_MISSING" || value === "APPLIER_PROFILE_REQUIRED" || value === "APPLIER_RESUME_NOT_ALLOWED" ? "orange" : undefined}>{value}</Tag> },
    { title: "Reason", dataIndex: "reason", render: (value, row) => value || (row.code === "RESUME_PROFILE_MISSING" ? "This Resume is not assigned to any Applier profile." : row.code === "APPLIER_PROFILE_REQUIRED" ? "Applier has no profiles." : row.code === "APPLIER_RESUME_NOT_ALLOWED" ? "Resume not assigned to this Applier." : "—") },
  ];
  const resultColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value?.slice(0, 8) || "—"}</Text> },
    { title: "Outcome", dataIndex: "outcome", render: (value) => <StatusTag value={value} /> },
    { title: "Reason", dataIndex: "message" },
  ];

  let content;
  if (!ids.length) {
    content = <Alert type="error" showIcon message="Select one or more Applications from the Applications page to assign or reassign." />;
  } else if (step === 0) {
    content = (
      <Card>
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Statistic title="Selected Applications" value={ids.length} />
          <Alert type="info" showIcon message="Each Application is assigned to the Applier who owns that Resume profile. Unassigned Applications can be assigned, and active assigned Applications can be moved when the profile Applier differs. Completed or cancelled Applications are excluded." />
          <Button type="primary" loading={busy} onClick={generate}>Generate Preview</Button>
        </Space>
      </Card>
    );
  } else if (step === 1) {
    const profileExclusions = (preview?.excludedApplications || []).filter((row) =>
      row.code === "RESUME_PROFILE_MISSING" || row.code === "APPLIER_PROFILE_REQUIRED" || row.code === "APPLIER_RESUME_NOT_ALLOWED");
    content = (
      <>
        <Row gutter={16}>
          {[["Assignable", proposals.length], ["Excluded", preview?.excludedApplicationCount || 0], ["Appliers", preview?.selectedApplierCount || 0]].map(([title, value]) => (
            <Col span={8} key={title}><Card><Statistic title={title} value={value} /></Card></Col>
          ))}
        </Row>
        {profileExclusions.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16, marginTop: 16 }}
            message={`${profileExclusions.length} Application${profileExclusions.length === 1 ? "" : "s"} excluded because the Resume has no Applier profile, or the mapped Applier cannot receive it.`}
          />
        )}
        <Card title="Proposed Assignments" style={{ marginTop: 16 }}>
          <Table rowKey="applicationId" columns={proposalColumns} dataSource={proposals} pagination={{ pageSize: 25 }} scroll={{ x: "max-content" }} />
        </Card>
        {preview?.excludedApplications?.length > 0 && (
          <Card title="Excluded Applications">
            <Table rowKey="applicationId" columns={exclusionColumns} dataSource={preview.excludedApplications} pagination={{ pageSize: 10 }} />
          </Card>
        )}
        {(preview?.applierSummaries || []).length > 0 && (
          <Card title="Projected Workload">
            {(preview.applierSummaries || []).filter((summary) => summary.proposedCount).map((summary) => (
              <Flex key={summary.userId} justify="space-between" style={{ marginBottom: 8 }}>
                <Text>{summary.fullName}: +{summary.proposedCount}</Text>
                <Text>{summary.projectedWorkload}/{summary.maxCapacity}</Text>
              </Flex>
            ))}
          </Card>
        )}
        <Flex className="table-footer-actions" justify="space-between">
          <Button onClick={() => setStep(0)}>Back</Button>
          <Button type="primary" disabled={!proposals.length} onClick={() => setConfirm(true)}>Confirm Assignment</Button>
        </Flex>
      </>
    );
  } else {
    content = (
      <>
        <Result
          status={result?.failedCount || result?.skippedCount ? "warning" : "success"}
          title={`${result?.assignedCount || 0} Applications assigned`}
          subTitle={`${result?.skippedCount || 0} skipped · ${result?.failedCount || 0} failed`}
          extra={[
            <Button key="batch" href={`#/assignment-batches/${result?.batchId}`}>View Assignment Batch</Button>,
            <Button key="apps" type="primary" href="#/applications?status=ASSIGNED">Back to Applications</Button>,
          ]}
        />
        <Card title="Assignment Results">
          <Table rowKey="id" columns={resultColumns} dataSource={result?.results || []} pagination={{ pageSize: 25 }} />
        </Card>
      </>
    );
  }

  return (
    <div className="page">
      <Title level={1}>Bulk Assignment</Title>
      <Steps current={step} items={["Applications", "Preview", "Result"].map((title) => ({ title }))} />
      {error && <ErrorState message={error} />}
      <div style={{ marginTop: 24 }}>{content}</div>
      <Modal
        open={confirm}
        title="Confirm Bulk Assignment"
        okText={`Assign ${proposals.length} Applications`}
        confirmLoading={busy}
        onOk={assign}
        onCancel={() => !busy && setConfirm(false)}
      >
        <Input value={batchName} maxLength={120} placeholder="Optional batch name" onChange={(event) => setBatchName(event.target.value)} />
        <Descriptions
          column={1}
          style={{ marginTop: 16 }}
          items={[
            { key: "selected", label: "Applications Selected", children: ids.length },
            { key: "assignable", label: "Applications Assignable", children: proposals.length },
            { key: "excluded", label: "Applications Excluded", children: preview?.excludedApplicationCount || 0 },
            { key: "appliers", label: "Appliers Matched", children: preview?.selectedApplierCount || 0 },
            { key: "transition", label: "Effect", children: "Assign each Application to the Applier who owns its Resume profile" },
          ]}
        />
      </Modal>
    </div>
  );
}

export function ApplierWorkloadsPage({ client, apiBaseUrl }) {
  const [data, setData] = useState();
  const [edit, setEdit] = useState();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [form] = Form.useForm();
  useEffect(() => { setData(); appliersApi.getWorkloads(client, apiBaseUrl, { limit: 100, search }).then((response) => setData(response.data)).catch((failure) => setError(failure.message)); }, [client, apiBaseUrl, reload, search]);
  function open(row) { setEdit(row); form.setFieldsValue({ isAvailable: row.isAvailable, maxActiveApplications: row.maxActiveApplications }); }
  async function save() { try { const value = await form.validateFields(); await appliersApi.updateWorkloadSettings(client, apiBaseUrl, edit.userId, value); setEdit(); setReload((current) => current + 1); } catch (failure) { if (failure?.message) setError(failure.message); } }
  const columns = [
    { title: "Name", dataIndex: "fullName" }, { title: "Email", dataIndex: "email" },
    { title: "Available", dataIndex: "isAvailable", render: (value) => <Checkbox checked={value} disabled /> },
    { title: "Active", dataIndex: "activeApplicationCount" }, { title: "Maximum", dataIndex: "maxActiveApplications" },
    { title: "Remaining", dataIndex: "remainingCapacity" }, { title: "Settings", sortable: false, render: (_, row) => <Button onClick={() => open(row)}>Edit</Button> },
  ];
  return <div className="page">{error && <ErrorState message={error} />}<Input.Search allowClear placeholder="Search Appliers by name or email" onSearch={(value) => setSearch(value.trim())} style={{ maxWidth: 420, marginBottom: 16 }} />{!data ? <LoadingState /> : <Card><Table rowKey="userId" dataSource={data} pagination={{ pageSize: 25 }} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 240px)" }} /></Card>}<Modal open={!!edit} title="Workload Settings" onOk={save} onCancel={() => setEdit()}><Form form={form} layout="vertical"><Form.Item name="isAvailable" label="Available For Assignment" valuePropName="checked"><Switch /></Form.Item><Form.Item name="maxActiveApplications" label="Maximum Active Applications" rules={[{ required: true }]}><InputNumber min={1} max={10000} /></Form.Item></Form></Modal></div>;
}

export function AssignmentBatchesPage({ client, apiBaseUrl }) {
  const [data, setData] = useState();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState();
  const [previous, setPrevious] = useState([]);
  useEffect(() => { setData(); assignmentBatchesApi.list(client, apiBaseUrl, { limit: 25, cursor }).then(setData).catch((failure) => setError(failure.message)); }, [client, apiBaseUrl, cursor]);
  const columns = [
    { title: "Name", dataIndex: "name", render: (value, row) => <a href={`#/assignment-batches/${row.id}`}>{value || row.id.slice(0, 8)}</a> },
    { title: "Strategy", dataIndex: "strategy", render: (value) => <Tag>{value}</Tag> }, { title: "Requested", dataIndex: "requestedCount" },
    { title: "Assigned", dataIndex: "assignedCount" }, { title: "Skipped", dataIndex: "skippedCount" }, { title: "Failed", dataIndex: "failedCount" },
    { title: "Status", dataIndex: "status", render: (value) => <StatusTag value={value} /> }, { title: "Created By", dataIndex: "creatorName" },
    { title: "Created", dataIndex: "createdAt", render: formatDate },
  ];
  return <div className="page">{error ? <ErrorState message={error} /> : !data ? <LoadingState /> : <Card><Table rowKey="id" dataSource={data.data} pagination={false} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 240px)" }} /><Flex justify="space-between" style={{ marginTop: 16 }}><Text>{data.data.length} shown</Text><Space><Button disabled={!previous.length} onClick={() => { const history = [...previous]; setCursor(history.pop()); setPrevious(history); }}>Previous</Button><Button disabled={!data.page?.nextCursor} onClick={() => { setPrevious((history) => [...history, cursor]); setCursor(data.page.nextCursor); }}>Next</Button></Space></Flex></Card>}</div>;
}

export function AssignmentBatchDetailPage({ client, apiBaseUrl, id }) {
  const [batch, setBatch] = useState();
  const [results, setResults] = useState();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState();
  const [previous, setPrevious] = useState([]);
  useEffect(() => { assignmentBatchesApi.getById(client, apiBaseUrl, id).then(setBatch).catch((failure) => setError(failure.message)); }, [client, apiBaseUrl, id]);
  useEffect(() => { setResults(); assignmentBatchesApi.getResults(client, apiBaseUrl, id, { limit: 25, cursor }).then(setResults).catch((failure) => setError(failure.message)); }, [client, apiBaseUrl, id, cursor]);
  const columns = [
    { title: "Application #", dataIndex: "applicationNumber" }, { title: "Company", dataIndex: "company" }, { title: "Job Title", dataIndex: "jobTitle" },
    { title: "Applier", dataIndex: "newAssigneeName" }, { title: "Outcome", dataIndex: "outcome", render: (value) => <StatusTag value={value} /> },
    { title: "Reason", dataIndex: "message" },
  ];
  return <div className="page"><Button type="link" href="#/assignment-batches">Back to Assignment Batches</Button><Title level={1}>Assignment Batch</Title>{error ? <ErrorState message={error} /> : !batch || !results ? <LoadingState /> : <><Card><Descriptions items={Object.entries({ Name: batch.name || "Unnamed", Strategy: batch.strategy, Status: batch.status, Requested: batch.requestedCount, Assigned: batch.assignedCount, Skipped: batch.skippedCount, Failed: batch.failedCount, Created: formatDate(batch.createdAt) }).map(([label, children]) => ({ key: label, label, children }))} /></Card><Card><Table rowKey="id" dataSource={results.data} pagination={false} columns={columns} /><Flex justify="space-between" style={{ marginTop: 16 }}><Text>{results.data.length} outcomes shown</Text><Space><Button disabled={!previous.length} onClick={() => { const history = [...previous]; setCursor(history.pop()); setPrevious(history); }}>Previous</Button><Button disabled={!results.page?.nextCursor} onClick={() => { setPrevious((history) => [...history, cursor]); setCursor(results.page.nextCursor); }}>Next</Button></Space></Flex></Card></>}</div>;
}
