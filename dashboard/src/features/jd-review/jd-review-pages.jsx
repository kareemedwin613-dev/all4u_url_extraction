import React, {useCallback, useEffect, useState} from "react";
import {Alert, Button, Card, Popconfirm, Progress, Space, Table, Tag, Typography} from "antd";
import {jdReviewRequest} from "../../services/jd-review-service.js";
const {Title, Paragraph, Text} = Typography;
const terminal = status => !["PENDING", "RUNNING"].includes(status);
const label = status => ({AI_REVIEWED:"AI reviewed", APPROVED:"AI reviewed", NEEDS_ATTENTION:"Not completed (legacy)"})[status] || status.replaceAll("_", " ").toLowerCase().replace(/^./, x => x.toUpperCase());
const color = status => ({AI_REVIEWED:"green", APPROVED:"green", BLOCKED:"red", FAILED:"red", RUNNING:"blue"})[status];

export function JdReviewBatchesPage({client, apiBaseUrl}) {
  const [data,setData] = useState([]), [error,setError] = useState(""), [loading,setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await jdReviewRequest(client,apiBaseUrl,"list")); setError(""); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  },[client,apiBaseUrl]);
  useEffect(() => { load(); },[load]);
  return <div className="page"><Title level={1}>JD Review Batches</Title>
    <Paragraph>Classify saved JD content, correct wrong values and fill blank fields. Completed AI reviews approve automatically, including corrections. One primary category; multiple subtypes only for Software Engineering. Assigned applications are skipped. Live URLs are not checked.</Paragraph>
    <Space><Button href="#/jobs">Select JDs</Button><Button onClick={load}>Refresh</Button></Space>
    {error && <Alert type="error" showIcon message={error}/>}
    <Card><Table rowKey="id" dataSource={data} loading={loading} pagination={{pageSize:25}} columns={[
      {title:"Created",render:(_,r)=><a href={`#/jd-review-batches/${r.id}`}>{new Date(r.created_at).toLocaleString()}</a>},
      {title:"Progress",render:(_,r)=>`${r.finished} / ${r.total}`},
      {title:"AI reviewed",dataIndex:"ai_reviewed"},
      {title:"Failed",dataIndex:"failed"},
      {title:"Status",render:(_,r)=>r.cancelled ? "Cancelled" : Number(r.finished) === Number(r.total) ? "Finished" : "Pending / in progress"},
      {title:"Prompt version",dataIndex:"prompt_version"},
    ]}/></Card></div>;
}

export function JdReviewBatchDetailPage({client, apiBaseUrl, id}) {
  const [data,setData] = useState(), [error,setError] = useState(""), [busy,setBusy] = useState(false), [runner,setRunner] = useState();
  const load = useCallback(async () => {
    try { const result = await jdReviewRequest(client,apiBaseUrl,"detail",{id}); setData(result); setError(""); }
    catch (e) { setError(e.message); }
  },[client,apiBaseUrl,id]);
  useEffect(() => { setData(undefined); setRunner(undefined); load(); },[load]);
  const items = data?.items || [], finished = items.filter(x => terminal(x.status)).length;
  const legacy = Boolean(data && data.batch.prompt_version !== "jd-classify-v4");
  const unfinished = Boolean(data && !data.batch.cancelled && finished < items.length);
  const active = unfinished && !legacy;
  useEffect(() => { if (!active) return; const timer = setInterval(load,5000); return () => clearInterval(timer); },[active,load]);
  async function action(operation) {
    setBusy(true);
    try { const value = await jdReviewRequest(client,apiBaseUrl,operation,{id}); if (operation === "ticket") setRunner(value); if (operation === "cancel") setRunner(undefined); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function restartAsClassification() {
    setBusy(true);
    try {
      const batch = await jdReviewRequest(client,apiBaseUrl,"create",{jobDescriptionIds:items.map(x=>x.job_description_id).filter(Boolean)});
      location.assign(`#/jd-review-batches/${batch.id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const command = runner ? `npm run jd-review:run -- --batch-ticket "${runner.ticket}" --api-base-url "${apiBaseUrl || location.origin}"` : "";
  const completed = items.filter(x => x.started_at && x.finished_at && ["AI_REVIEWED","APPROVED","BLOCKED","FAILED"].includes(x.status));
  const estimatedSeconds = completed.length ? Math.ceil(completed.reduce((n,x)=>n + Math.max(0,new Date(x.finished_at)-new Date(x.started_at)),0) / completed.length / 1000 * (items.length-finished) / 2) : null;
  const stale = items.some(x => x.status === "RUNNING" && new Date(x.lease_expires_at).getTime() < Date.now());
  return <div className="page"><Button type="link" href="#/jd-review-batches">Back to JD Review Batches</Button>
    <Title level={1}>{legacy ? "Legacy JD Review" : "Bulk JD Classification"}</Title>{error && <Alert type="error" showIcon message={error}/>}
    {!data ? <Card loading={!error}/> : <>
      <Card><Space orientation="vertical" style={{width:"100%"}}>
        <Text>{data.batch.model} · Medium reasoning · Concurrency 2 · {data.batch.prompt_version}</Text>
        {legacy ? <Alert type="warning" showIcon message="This batch used older review rules. Its history is preserved." description={<Button loading={busy} disabled={!items.some(x=>x.job_description_id)} onClick={restartAsClassification}>Create classification batch from these JDs</Button>}/>
          : <Alert type="info" showIcon message="Saved JD content only — no website visits, expiration checks or new blocking decisions." description="AI corrects wrong values, fills supported blanks and approves automatically. Uncertain fields stay unchanged with a comment. All saved changes retain before/after history."/>}
        <Progress percent={items.length ? Math.round(100 * finished/items.length) : 100}/>
        <Text>{finished} / {items.length} finished · {items.filter(x=>["AI_REVIEWED","APPROVED"].includes(x.status)).length} AI reviewed · {items.filter(x=>x.status==="BLOCKED").length} blocked · {items.filter(x=>x.status==="FAILED").length} failed · {items.filter(x=>x.status==="SKIPPED").length} skipped</Text>
        {active && <Text type="secondary">{estimatedSeconds == null ? "ETA appears after the first completed review." : `Estimated remaining: ${Math.ceil(estimatedSeconds/60)} min while a runner is active (approximate).`}</Text>}
        {stale && <Alert type="warning" showIcon message="A worker lease expired. Keep the runner open or create a resume command; interrupted items are reclaimed automatically."/>}
        <Alert type="info" showIcon message="No second manual approval is required after AI review. Technical failures leave JD fields and approval status unchanged and can be retried. Assigned, archived, or blocked JDs are skipped."/>
        <Space wrap>
          <Button onClick={load}>Refresh</Button>
          <Button type="primary" loading={busy} disabled={!active} onClick={()=>action("ticket")}>Create / resume runner command</Button>
          <Button loading={busy} disabled={legacy || data.batch.cancelled || !items.some(x=>x.status==="FAILED")} onClick={()=>action("retry")}>Retry failed items</Button>
          {unfinished && <Popconfirm title="Cancel remaining JD reviews?" onConfirm={()=>action("cancel")}><Button danger loading={busy}>Cancel batch</Button></Popconfirm>}
        </Space>
        {runner && <Alert type="success" message="Run from your updated repository root" description={<>
          <Paragraph code copyable={{text:command}}>{command}</Paragraph>
          <Text>Sign in to Codex first. This ticket expires in 24 hours; generating another revokes it. Progress continues in the background if the terminal closes. Keep the computer awake.</Text>
        </>}/>} 
      </Space></Card>
      <Card title="Results and history" style={{marginTop:16}}><Table rowKey="id" dataSource={items} pagination={{pageSize:25}} scroll={{x:900}} columns={[
        {title:"Job",render:(_,r)=>r.job_description_id ? <a href={`#/jobs/${r.job_description_id}`}>{r.company} — {r.job_title}</a> : "Deleted JD"},
        {title:"Status",dataIndex:"status",render:s=><Tag color={color(s)}>{label(s)}</Tag>},
        {title:"Attempts",dataIndex:"attempt_count"},
        {title:"Finder comment / diagnostic",dataIndex:"comment",render:v=>v || "Waiting for worker"},
        {title:"Updated fields",render:(_,r)=>Object.keys(r.changes || {}).join(", ") || "None"},
      ]} expandable={{expandedRowRender:r=><Space orientation="vertical" style={{width:"100%"}}>{Object.entries(r.fieldChanges || {}).map(([key,value])=><Paragraph key={key}><Text strong>{key}: </Text>{JSON.stringify(value.before)} → {JSON.stringify(value.after)}</Paragraph>)}<Text type="secondary">{r.finished_at ? `Finished ${new Date(r.finished_at).toLocaleString()}` : "Review has not finished."}</Text></Space>}}/></Card>
    </>}
  </div>;
}
