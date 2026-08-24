import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Flex, Form, Input,
  InputNumber, Modal, Progress, Radio, Result, Row, Select, Space, Statistic,
  Steps, Switch, Table as AntTable, Tag, Typography,
} from "antd";
import { ErrorState, LoadingState, StatusTag } from "../../components/ui.jsx";
import { formatDate } from "../../shared/formatters.js";
import { clientSortColumns } from "../../shared/table-sorting.js";
import {
  appliersApi, assignmentBatchesApi, bulkAssignmentApi, parseAssignmentIds,
} from "./bulk-assignment-service.js";

const { Title, Text } = Typography;
const Table = (props) => <AntTable {...props} columns={clientSortColumns(props.columns)} />;
const strategies = [
  { value: "MANUAL", label: "Manual", description: "Choose an Applier for each Application." },
  { value: "EVEN", label: "Even Distribution", description: "Balance projected active workload deterministically." },
  { value: "CAPACITY_AWARE", label: "Capacity-aware", description: "Use the greatest remaining capacity first." },
];
const newKey = () => `assign-${crypto.randomUUID()}`;
const eligible = (workload) => workload.isAvailable && workload.remainingCapacity > 0;

function capacityState(proposals, workloads) {
  const map = new Map(workloads.map((workload) => [workload.userId, { ...workload, count: 0, freed: 0 }]));
  for (const proposal of proposals) {
    if (proposal.currentAssigneeId && proposal.currentAssigneeId === proposal.proposedAssigneeId) continue;
    if (proposal.currentAssigneeId) {
      const previous = map.get(proposal.currentAssigneeId);
      if (previous) previous.freed += 1;
    }
    const workload = map.get(proposal.proposedAssigneeId);
    if (workload) workload.count += 1;
  }
  const summaries = [...map.values()]
    .filter((workload) => workload.count || workload.freed)
    .map((workload) => {
      const projected = workload.activeApplicationCount - workload.freed + workload.count;
      return {
        ...workload,
        projected,
        valid: projected <= workload.maxActiveApplications,
      };
    });
  return { summaries, valid: summaries.every((summary) => summary.valid) };
}

export function BulkAssignmentWizardPage({ client, apiBaseUrl, query }) {
  const ids = useMemo(() => parseAssignmentIds(query), [query]);
  const [step, setStep] = useState(0);
  const [workloads, setWorkloads] = useState();
  const [workloadSearch, setWorkloadSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [strategy, setStrategy] = useState("CAPACITY_AWARE");
  const [manual, setManual] = useState({});
  const [preview, setPreview] = useState();
  const [proposals, setProposals] = useState([]);
  const [result, setResult] = useState();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [batchName, setBatchName] = useState("");
  const keyRef = useRef();

  useEffect(() => {
    appliersApi.getWorkloads(client, apiBaseUrl, { limit: 100, search: workloadSearch })
      .then((response) => setWorkloads(response.data))
      .catch((failure) => setError(failure.message));
  }, [client, apiBaseUrl, workloadSearch]);

  const capacity = useMemo(() => capacityState(proposals, workloads || []), [proposals, workloads]);
  const summaryFor = (row) => capacity.summaries.find((item) => item.userId === row.proposedAssigneeId);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const assignments = ids.map((applicationId, index) => ({
        applicationId,
        assignedTo: manual[applicationId] || selected[index % selected.length],
      }));
      const body = strategy === "MANUAL"
        ? { strategy, assignments }
        : { strategy, applicationIds: ids, applierIds: selected };
      const data = await bulkAssignmentApi.preview(client, apiBaseUrl, body);
      setPreview(data);
      setProposals(data.proposals || []);
      keyRef.current = undefined;
      setStep(3);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function changeAssignee(applicationId, userId) {
    const workload = workloads.find((item) => item.userId === userId);
    setProposals((rows) => rows.map((row) => row.applicationId === applicationId
      ? { ...row, proposedAssigneeId: userId, proposedAssigneeName: workload.fullName }
      : row));
    keyRef.current = undefined;
  }

  async function assign() {
    if (!capacity.valid || !proposals.length || busy) return;
    setBusy(true);
    setError("");
    try {
      keyRef.current ||= newKey();
      const data = await bulkAssignmentApi.assign(client, apiBaseUrl, {
        batchName: batchName || undefined,
        strategy,
        assignments: proposals.map((proposal) => ({
          applicationId: proposal.applicationId,
          assignedTo: proposal.proposedAssigneeId,
        })),
      }, keyRef.current);
      setResult(data);
      setConfirm(false);
      setStep(4);
    } catch (failure) {
      setError(failure.message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const workloadColumns = [
    { title: "Applier", dataIndex: "fullName", render: (value, row) => <><Text strong>{value}</Text><br /><Text type="secondary">{row.email}</Text></> },
    { title: "Available", dataIndex: "isAvailable", render: (value) => <Tag color={value ? "green" : "default"}>{value ? "Available" : "Unavailable"}</Tag> },
    { title: "Active", dataIndex: "activeApplicationCount" },
    { title: "Capacity", dataIndex: "maxActiveApplications" },
    { title: "Remaining", dataIndex: "remainingCapacity", render: (value, row) => <Progress percent={Math.round(value / row.maxActiveApplications * 100)} size="small" format={() => value} /> },
  ];
  const proposalColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value.slice(0, 8)}</Text> },
    { title: "Company", dataIndex: "company" },
    { title: "Job Title", dataIndex: "jobTitle" },
    { title: "Candidate", dataIndex: "candidateName" },
    { title: "Resume", dataIndex: "resumeName" },
    { title: "Proposed Applier", dataIndex: "proposedAssigneeId", sortValue: (row) => row.proposedAssigneeName, render: (value, row) => <Select value={value} style={{ minWidth: 220 }} onChange={(next) => changeAssignee(row.applicationId, next)} options={(workloads || []).filter(eligible).map((workload) => ({ value: workload.userId, label: `${workload.fullName} (${workload.remainingCapacity} open)` }))} /> },
    { title: "Current Workload", sortValue: (row) => summaryFor(row)?.activeApplicationCount ?? -1, render: (_, row) => summaryFor(row)?.activeApplicationCount ?? "—" },
    { title: "Proposed Increase", sortValue: (row) => summaryFor(row)?.count ?? -1, render: (_, row) => summaryFor(row)?.count ?? "—" },
    { title: "Final Workload", sortValue: (row) => summaryFor(row)?.projected ?? -1, render: (_, row) => summaryFor(row)?.projected ?? "—" },
    { title: "Capacity", sortValue: (row) => summaryFor(row)?.maxActiveApplications ?? -1, render: (_, row) => summaryFor(row)?.maxActiveApplications ?? "—" },
    { title: "Remaining", sortValue: (row) => { const summary = summaryFor(row); return summary ? summary.maxActiveApplications - summary.projected : -1; }, render: (_, row) => { const summary = summaryFor(row); return summary ? summary.maxActiveApplications - summary.projected : "—"; } },
  ];
  const exclusionColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value?.slice(0, 8) || "—"}</Text> },
    { title: "Code", dataIndex: "code", render: (value) => <Tag>{value}</Tag> },
    { title: "Reason", dataIndex: "reason" },
  ];
  const resultColumns = [
    { title: "Application", dataIndex: "applicationId", render: (value) => <Text code>{value?.slice(0, 8) || "—"}</Text> },
    { title: "Outcome", dataIndex: "outcome", render: (value) => <StatusTag value={value} /> },
    { title: "Reason", dataIndex: "message" },
  ];

  let content;
  if (!ids.length) {
    content = <Alert type="error" showIcon message="Select one or more Applications from the Applications page to assign or reassign." />;
  } else if (!workloads) {
    content = <LoadingState text="Loading Applier workloads…" />;
  } else if (step === 0) {
    content = <Card><Space orientation="vertical" size="middle" style={{ width: "100%" }}><Statistic title="Selected Applications" value={ids.length} /><Alert type="info" showIcon message="Unassigned Applications can be assigned, and active assigned Applications can be moved to other Appliers. Completed or cancelled Applications are excluded." /><Button type="primary" onClick={() => setStep(1)}>Choose Appliers</Button></Space></Card>;
  } else if (step === 1) {
    content = <Card><Input.Search allowClear placeholder="Search Appliers by name or email" onSearch={(value) => { setSelected([]); setWorkloadSearch(value.trim()); }} style={{ maxWidth: 420, marginBottom: 16 }} /><Table rowKey="userId" columns={workloadColumns} dataSource={workloads} pagination={false} rowSelection={{ selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: (row) => ({ disabled: !eligible(row) }) }} /><Flex className="table-footer-actions" justify="space-between"><Button onClick={() => setStep(0)}>Back</Button><Button type="primary" disabled={!selected.length} onClick={() => setStep(2)}>Choose Distribution</Button></Flex></Card>;
  } else if (step === 2) {
    content = <Card><Radio.Group value={strategy} onChange={(event) => setStrategy(event.target.value)}><Space orientation="vertical">{strategies.map((item) => <Radio key={item.value} value={item.value}><Text strong>{item.label}</Text> — {item.description}</Radio>)}</Space></Radio.Group>{strategy === "MANUAL" && <div style={{ marginTop: 20 }}>{ids.map((id, index) => <Form.Item key={id} label={`Application ${id.slice(0, 8)}`}><Select value={manual[id] || selected[index % selected.length]} onChange={(value) => setManual((current) => ({ ...current, [id]: value }))} options={workloads.filter((workload) => selected.includes(workload.userId) && eligible(workload)).map((workload) => ({ value: workload.userId, label: workload.fullName }))} /></Form.Item>)}</div>}<Flex className="table-footer-actions" justify="space-between"><Button onClick={() => setStep(1)}>Back</Button><Button type="primary" loading={busy} onClick={generate}>Generate Preview</Button></Flex></Card>;
  } else if (step === 3) {
    content = <><Row gutter={16}>{[["Assignable", proposals.length], ["Excluded", preview?.excludedApplicationCount || 0], ["Appliers", capacity.summaries.length]].map(([title, value]) => <Col span={8} key={title}><Card><Statistic title={title} value={value} /></Card></Col>)}</Row>{!capacity.valid && <Alert type="error" showIcon message="One or more adjusted assignments exceeds capacity." />}<Card title="Proposed Assignments"><Table rowKey="applicationId" columns={proposalColumns} dataSource={proposals} pagination={{ pageSize: 25 }} scroll={{ x: "max-content" }} /></Card>{preview?.excludedApplications?.length > 0 && <Card title="Excluded Applications"><Table rowKey="applicationId" columns={exclusionColumns} dataSource={preview.excludedApplications} pagination={{ pageSize: 10 }} /></Card>}<Card title="Projected Workload">{capacity.summaries.map((summary) => <div key={summary.userId}><Flex justify="space-between"><Text>{summary.fullName}: {summary.count ? `+${summary.count}` : "±0"}{summary.freed ? ` · −${summary.freed}` : ""}</Text><Text type={summary.valid ? undefined : "danger"}>{summary.projected}/{summary.maxActiveApplications}</Text></Flex><Progress percent={Math.min(100, Math.round(summary.projected / summary.maxActiveApplications * 100))} status={summary.valid ? "normal" : "exception"} /></div>)}</Card><Flex className="table-footer-actions" justify="space-between"><Button onClick={() => setStep(2)}>Back</Button><Button type="primary" disabled={!proposals.length || !capacity.valid} onClick={() => setConfirm(true)}>Confirm Assignment</Button></Flex></>;
  } else {
    content = <><Result status={result?.failedCount || result?.skippedCount ? "warning" : "success"} title={`${result?.assignedCount || 0} Applications assigned`} subTitle={`${result?.skippedCount || 0} skipped · ${result?.failedCount || 0} failed`} extra={[<Button key="batch" href={`#/assignment-batches/${result?.batchId}`}>View Assignment Batch</Button>, <Button key="apps" type="primary" href="#/applications?status=ASSIGNED">Back to Applications</Button>]} /><Card title="Assignment Results"><Table rowKey="id" columns={resultColumns} dataSource={result?.results || []} pagination={{ pageSize: 25 }} /></Card></>;
  }

  return <div className="page"><Title level={1}>Bulk Assignment</Title><Steps current={step} items={["Applications", "Appliers", "Distribution", "Preview", "Result"].map((title) => ({ title }))} />{error && <ErrorState message={error} />}<div style={{ marginTop: 24 }}>{content}</div><Modal open={confirm} title="Confirm Bulk Assignment" okText={`Assign ${proposals.length} Applications`} confirmLoading={busy} okButtonProps={{ disabled: !capacity.valid }} onOk={assign} onCancel={() => !busy && setConfirm(false)}><Input value={batchName} maxLength={120} placeholder="Optional batch name" onChange={(event) => setBatchName(event.target.value)} /><Descriptions column={1} style={{ marginTop: 16 }} items={[{ key: "selected", label: "Applications Selected", children: ids.length }, { key: "assignable", label: "Applications Assignable", children: proposals.length }, { key: "excluded", label: "Applications Excluded", children: preview?.excludedApplicationCount || 0 }, { key: "appliers", label: "Appliers Selected", children: selected.length }, { key: "transition", label: "Effect", children: "Assign unassigned Applications and reassign active ones to the proposed Appliers" }]} />{capacity.summaries.map((summary) => <p key={summary.userId}>{summary.fullName}: {summary.count ? `+${summary.count}` : "no new"}{summary.freed ? ` · −${summary.freed} reassigned away` : ""} ({summary.projected}/{summary.maxActiveApplications})</p>)}</Modal></div>;
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
