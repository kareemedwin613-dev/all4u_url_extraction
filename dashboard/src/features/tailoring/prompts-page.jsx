import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Row, Space, Spin, Tag, Tree, Typography } from "antd";
import { promptRequest, buildPromptTree, promptDraftValues } from "./prompts-service.js";
import { registerNavigationGuard } from "../../shared/navigation-guard.js";
const { Title, Paragraph, Text } = Typography;

export function TailoringPromptsPage({ client, apiBaseUrl, categories }) {
  const { modal, message } = App.useApp();
  const [prompts, setPrompts] = useState([]), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(promptDraftValues()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [jdId, setJdId] = useState(""), [preview, setPreview] = useState(null), [applicationId, setApplicationId] = useState("");
  const [testRun, setTestRun] = useState(null), [testTicket, setTestTicket] = useState("");
  const [expandedKeys, setExpandedKeys] = useState(null);
  const requestSequence = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(promptDraftValues(detail));
  const tree = useMemo(() => buildPromptTree(prompts, categories), [prompts, categories]);
  const api = (path = "", method = "GET", body) => promptRequest(client, apiBaseUrl, path, method, body);
  const allowDiscard = () => !dirty || window.confirm("Discard unsaved prompt changes?");
  const refresh = async () => setPrompts(await api());
  useEffect(() => { let live = true; promptRequest(client, apiBaseUrl).then(rows => live && setPrompts(rows)).catch(e => live && setError(e.message)); return () => { live = false; requestSequence.current++; }; }, [client, apiBaseUrl]);
  useEffect(() => registerNavigationGuard(allowDiscard), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!testRun?.id || !["PENDING", "PROCESSING"].includes(testRun.status)) return;
    let live = true;
    const timer = setInterval(() => promptRequest(client, apiBaseUrl, `/tests/${testRun.id}`).then(value => live && setTestRun(value)).catch(e => live && setError(e.message)), 5000);
    return () => { live = false; clearInterval(timer); };
  }, [client, apiBaseUrl, testRun?.id, testRun?.status]);
  async function select(node) {
    if (busy || !allowDiscard()) return;
    const sequence = ++requestSequence.current;
    setError(""); setBusy(true);
    try {
      const value = node.promptId ? await api(`/${node.promptId}`) : null;
      if (sequence !== requestSequence.current) return;
      setSelected(node); setDetail(value); setDraft(promptDraftValues(value)); setTestRun(null); setTestTicket("");
    } catch (e) { setError(e.message); } finally { if (sequence === requestSequence.current) setBusy(false); }
  }
  function accept(value) { setDetail(value); setDraft(promptDraftValues(value)); setSelected({ key: `prompt:${value.id}`, promptId: value.id }); }
  async function action(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const save = () => action(async () => {
    const value = detail ? await api(`/${detail.id}/draft`, "PUT", { ...draft, expectedRevision: detail.revision })
      : await api("", "POST", { ...draft, scope: selected.scope, primaryCategoryId: selected.primaryCategoryId || null, subcategoryId: selected.subcategoryId || null });
    accept(value); await refresh(); message.success("Draft saved. Published instructions are unchanged.");
  });
  function confirmMutation(kind, version) {
    modal.confirm({ title: `${kind === "restore" ? `Restore v${version} as a new published version` : kind === "archive" ? "Archive this prompt" : "Publish saved draft"}?`,
      content: "Existing tailoring jobs keep their saved prompt. Restoring replaces the working draft; version history is preserved.",
      onOk: () => action(async () => {
        const value = await api(`/${detail.id}/${kind}`, "POST", { expectedRevision: detail.revision, ...(version ? { version } : {}) });
        accept(value); await refresh();
      }) });
  }
  return <div className="page">
    <Title level={1}>Tailoring Prompts</Title>
    <Paragraph>Select a category or subtype to create a draft, or select a prompt to edit it. Highest-priority matching subtype wins, then category default, then Generic.</Paragraph>
    <Alert type="info" showIcon message="Published versions are immutable. New jobs use the current published prompt; existing jobs and retries keep their snapshot." />
    {error && <Alert type="error" showIcon message={error} description="For an edit conflict, reload the prompt and reconcile your changes before saving again." />}
    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
      <Col xs={24} lg={9}><Card title="Prompt tree" extra={<Button disabled={busy} onClick={() => action(refresh)}>Refresh tree</Button>}>
        <Tree treeData={tree} selectedKeys={selected ? [selected.key] : []} expandedKeys={expandedKeys ?? tree.flatMap(node => [node.key, ...(node.children || []).filter(child => !child.isLeaf).map(child => child.key)])} onExpand={setExpandedKeys} onSelect={(_, info) => select(info.node)} blockNode />
      </Card></Col>
      <Col xs={24} lg={15}><Spin spinning={busy}>
        {!selected ? <Card>Select a prompt or category from the tree.</Card> : <Card title={detail ? detail.draft_name : `New ${selected.scope.toLowerCase()} prompt`} extra={dirty ? <Tag color="orange">Unsaved</Tag> : null}>
          {detail && <Space wrap><Tag>{detail.archived ? "Archived" : detail.published_version ? `Published v${detail.published_version}` : "Draft"}</Tag><Text>Revision {detail.revision}</Text><Button disabled={busy} onClick={() => select(selected)}>Reload</Button></Space>}
          <Form layout="vertical" disabled={busy} style={{ marginTop: 16 }}>
            <Form.Item label="Prompt name" required><Input value={draft.name} maxLength={120} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Form.Item>
            <Form.Item label="Priority" extra="Higher wins among matching subtype prompts. Published subtype priorities must be unique within a primary category."><InputNumber min={0} max={100000} precision={0} value={draft.priority} onChange={priority => setDraft({ ...draft, priority: priority ?? 0 })} /></Form.Item>
            <Form.Item label="Tailoring instructions" required extra="Edit writing instructions here. JSON structure, source identity/date fields, role targets, and skill formatting remain controlled by the worker."><Input.TextArea rows={16} maxLength={20000} showCount value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></Form.Item>
          </Form>
          <Space wrap>
            <Button type="primary" disabled={busy || !dirty || !draft.name.trim() || !draft.instructions.trim()} onClick={save}>Save draft</Button>
            {detail && <><Button disabled={busy || dirty || (!detail.draft_pending && !detail.archived)} onClick={() => confirmMutation("publish")}>Publish</Button>
              <Button danger disabled={busy || dirty || detail.archived || (detail.scope === "GENERIC" && Boolean(detail.published_version))} onClick={() => confirmMutation("archive")}>Archive</Button></>}
          </Space>
          {detail && <>
            <Title level={4}>Version history</Title>
            {(detail.versions || []).map(v => <details key={v.version} style={{ marginBottom: 12 }}><summary>v{v.version} · {v.name} · Priority {v.priority} · {new Date(v.published_at).toLocaleString()}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{v.body}</pre><Button disabled={busy || dirty} onClick={() => confirmMutation("restore", v.version)}>Restore as new version</Button></details>)}
            <Title level={4}>Test saved draft</Title>
            <Paragraph>This runs one preview without publishing, creating a PDF, or assigning a resume. Use an application that still has an original resume.</Paragraph>
            <Input aria-label="Test application ID" placeholder="Application UUID" value={applicationId} onChange={e => setApplicationId(e.target.value)} />
            <Button style={{ marginTop: 8 }} disabled={busy || dirty || !applicationId.trim()} onClick={() => action(async () => {
              const value = await api(`/${detail.id}/tests`, "POST", { applicationId: applicationId.trim(), expectedRevision: detail.revision });
              setTestRun(value.run); setTestTicket(value.ticket);
            })}>Create one-item test command</Button>
            {testTicket && <Paragraph copyable code style={{ marginTop: 12 }}>{`npm --prefix apps/tailoring-worker run prompt:test -- --prompt-test-ticket "${testTicket}" --api-base-url "${apiBaseUrl || location.origin}"`}</Paragraph>}
            {testRun && <><Tag>{testRun.status}</Tag>{testRun.failure_code && <Alert type="error" message={testRun.failure_code} />}{testRun.result && <pre style={{ whiteSpace: "pre-wrap", maxHeight: 500, overflow: "auto" }}>{JSON.stringify(testRun.result, null, 2)}</pre>}</>}
          </>}
        </Card>}
      </Spin></Col>
    </Row>
    <Card title="Which prompt will this JD use?" style={{ marginTop: 16 }}>
      <Input.Search aria-label="Preview job description ID" placeholder="Job Description UUID" value={jdId} onChange={e => { setJdId(e.target.value); setPreview(null); }} enterButton="Preview selection" loading={busy} onSearch={() => action(async () => setPreview(await api("/preview", "POST", { jobDescriptionId: jdId.trim() })))} />
      {preview && <Paragraph style={{ marginTop: 12 }}>{preview.name} · v{preview.version} · Priority {preview.priority}<br />{preview.reason}</Paragraph>}
    </Card>
  </div>;
}
