import React, {useCallback, useEffect, useState} from "react";
import {Alert, Button, Card, Input, Modal, Popconfirm, Progress, Space, Tag, Typography} from "antd";
import {ResizableTable as Table} from "../../shared/resizable-table.jsx";
import {screenshotReviewRequest} from "../../services/screenshot-review-service.js";
const {Title, Paragraph, Text} = Typography;
const terminal = status => !["PENDING", "RUNNING"].includes(status);
const labels = {CORRECT:"Correct", HAS_MISTAKES:"Has mistakes", CANNOT_VERIFY:"Cannot verify (unreviewed)", SKIPPED:"Skipped", FAILED:"Failed", PENDING:"Pending", RUNNING:"Reviewing"};
const statusTag = status => <Tag color={{CORRECT:"green",HAS_MISTAKES:"red",CANNOT_VERIFY:"orange",RUNNING:"blue",FAILED:"red"}[status]}>{labels[status] || status}</Tag>;
const disclosure = "AI checks visible pre-submission fields against a snapshot of the published Application Guide and original candidate metadata. This is not proof of submission. Uncertain results leave the application unreviewed. Already-reviewed applications are skipped.";

export function CreateScreenshotReview({client,apiBaseUrl,applicationIds,onCreated,onCancel}) {
  const [model,setModel] = useState("gpt-5.6-sol"), [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function create() {
    setBusy(true); setError("");
    try { const batch = await screenshotReviewRequest(client,apiBaseUrl,"create",{applicationIds,model:model.trim()}); onCreated(batch); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <Modal open title={`Review screenshots for ${applicationIds.length} applications`} onCancel={onCancel} onOk={create} confirmLoading={busy} okText="Create review batch" okButtonProps={{disabled:!model.trim() || !applicationIds.length || applicationIds.length>1000}}>
    <Paragraph>{disclosure}</Paragraph>
    <Alert type="info" showIcon message="GPA: format only. Citizenship: US citizen, per the configured business assumption. Other personal answers must be explicit, not inferred."/>
    <Paragraph style={{marginTop:16}}>Codex model with image support (must be available to your local login)</Paragraph>
    <Input aria-label="Screenshot review model" value={model} onChange={e=>setModel(e.target.value)} maxLength={101}/>
    <Paragraph type="secondary">Medium reasoning · Default service tier · Concurrency 2. Private screenshots are sent to the model through your local Codex session.</Paragraph>
    {error && <Alert type="error" showIcon message={error}/>}
  </Modal>;
}
export function ScreenshotReviewBatchesPage({client,apiBaseUrl}) {
  const [data,setData]=useState([]), [error,setError]=useState(""), [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);try{setData(await screenshotReviewRequest(client,apiBaseUrl,"list"));setError("");}catch(e){setError(e.message);}finally{setLoading(false);}},[client,apiBaseUrl]);
  useEffect(()=>{load();},[load]);
  return <div className="page"><Title level={1}>AI Screenshot Reviews</Title><Paragraph>{disclosure}</Paragraph>
    <Space><Button href="#/applications">Select applications</Button><Button onClick={load}>Refresh</Button></Space>
    {error&&<Alert type="error" message={error} showIcon/>}
    <Card><Table rowKey="id" dataSource={data} loading={loading} pagination={{pageSize:25}} columns={[
      {title:"Created",render:(_,r)=><a href={`#/screenshot-review-batches/${r.id}`}>{new Date(r.created_at).toLocaleString()}</a>},
      {title:"Progress",render:(_,r)=>`${r.finished} / ${r.total}`},
      {title:"Correct",dataIndex:"correct"},{title:"Has mistakes",dataIndex:"mistakes"},{title:"Cannot verify",dataIndex:"uncertain"},{title:"Failed",dataIndex:"failed"},
      {title:"State",render:(_,r)=>r.cancelled?"Cancelled":Number(r.finished)===Number(r.total)?"Finished":"Pending / reviewing"},
    ]}/></Card></div>;
}
function FieldResults({result}) {
  return <Table size="small" rowKey={(_,index)=>index} dataSource={result?.fields||[]} pagination={false} scroll={{x:800}} columns={[
    {title:"Field",dataIndex:"field"},{title:"Observed",dataIndex:"observed"},{title:"Expected",dataIndex:"expected"},
    {title:"Finding",dataIndex:"verdict"},{title:"Reason / evidence",dataIndex:"reason"},{title:"Location",dataIndex:"location"},
  ]}/>;
}
function ItemResult({client,apiBaseUrl,itemId}) {
  const [data,setData]=useState(),[error,setError]=useState("");
  useEffect(()=>{let alive=true;screenshotReviewRequest(client,apiBaseUrl,"result",{id:itemId}).then(r=>{if(alive)setData(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[client,apiBaseUrl,itemId]);
  return error?<Alert type="error" message={error}/>:!data?<Card loading/>:<FieldResults result={data.result}/>;
}
export function ScreenshotReviewBatchDetailPage({client,apiBaseUrl,id}) {
  const [data,setData]=useState(), [error,setError]=useState(""), [busy,setBusy]=useState(false), [ticket,setTicket]=useState("");
  const load=useCallback(async()=>{try{setData(await screenshotReviewRequest(client,apiBaseUrl,"detail",{id}));setError("");}catch(e){setError(e.message);}},[client,apiBaseUrl,id]);
  useEffect(()=>{setData(undefined);setTicket("");load();},[load]);
  const items=data?.items||[], finished=items.filter(r=>terminal(r.status)).length;
  const active=data&&!data.batch.cancelled&&finished<items.length;
  useEffect(()=>{if(!active)return;const timer=setInterval(load,5000);return()=>clearInterval(timer);},[active,load]);
  async function action(operation){setBusy(true);setError("");try{const result=await screenshotReviewRequest(client,apiBaseUrl,operation,{id});if(operation==="ticket")setTicket(result.ticket);if(operation==="cancel")setTicket("");await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const command=ticket?`npm run screenshot-review:run -- --batch-ticket "${ticket}" --api-base-url "${new URL(apiBaseUrl||window.location.origin).origin}"`:"";
  const stalled=items.some(i=>i.status==="RUNNING"&&Date.parse(i.lease_expires_at)<Date.now());
  return <div className="page"><a href="#/screenshot-review-batches">Back to AI Screenshot Reviews</a><Title level={1}>Screenshot Review Batch</Title>
    {error&&<Alert type="error" message={error} showIcon/>}
    {!data?<Card loading={!error}/>:<>
      <Card><Space orientation="vertical" style={{width:"100%"}}>
        <Text>{data.batch.model} · Medium reasoning · Concurrency 2 · {data.batch.prompt_version}</Text>
        <Alert type="info" message={disclosure} showIcon/>
        <Progress percent={items.length?Math.round(100*finished/items.length):100}/>
        <Text>{finished} / {items.length} finished · {items.filter(x=>x.status==="CORRECT").length} correct · {items.filter(x=>x.status==="HAS_MISTAKES").length} with mistakes · {items.filter(x=>x.status==="CANNOT_VERIFY").length} cannot verify</Text>
        {stalled&&<Alert type="warning" showIcon message="A worker lease expired. Resume the runner; interrupted items are reclaimed automatically."/>}
        <Space wrap><Button onClick={load}>Refresh</Button><Button type="primary" loading={busy} disabled={!active} onClick={()=>action("ticket")}>Create / resume runner command</Button>
          <Button loading={busy} disabled={data.batch.cancelled||!items.some(x=>x.status==="FAILED")} onClick={()=>action("retry")}>Retry failed items</Button>
          {active&&<Popconfirm title="Cancel remaining reviews?" onConfirm={()=>action("cancel")}><Button danger loading={busy}>Cancel batch</Button></Popconfirm>}
        </Space>
        {ticket&&<Alert type="success" message="Run in your updated local repository after npm install and Codex login" description={<><Paragraph code copyable={{text:command}}>{command}</Paragraph><Text>Keep the computer awake. Ticket expires in 24 hours; a new command revokes the previous ticket. Do not share this command.</Text></>}/>}
        <details><summary>Published guide snapshot ({data.batch.guide_snapshot.length} rules)</summary>{data.batch.guide_snapshot.map(g=><Paragraph key={g.id}><Text strong>{g.question} · v{g.version}</Text><br/>{g.howToAnswer}</Paragraph>)}</details>
      </Space></Card>
      <Card title="Results and diagnostics" style={{marginTop:16}}><Table rowKey="id" dataSource={items} pagination={{pageSize:25}} scroll={{x:850}} columns={[
        {title:"Application",render:(_,r)=><a href={`#/applications/${r.application_id}`}>#{r.application_number||r.application_id.slice(0,8)}</a>},
        {title:"Job",render:(_,r)=>`${r.company} — ${r.job_title}`},{title:"Candidate",dataIndex:"candidate_name"},
        {title:"Status",dataIndex:"status",render:statusTag},{title:"Attempts",dataIndex:"attempt_count"},{title:"Diagnostic",dataIndex:"diagnostic"},
      ]} expandable={{rowExpandable:r=>r.has_result,expandedRowRender:r=><ItemResult client={client} apiBaseUrl={apiBaseUrl} itemId={r.id}/>}}/>
      <Paragraph type="secondary">Cannot verify: correct missing metadata or replace unreadable/incomplete screenshots, then create a fresh batch. Failed: retry after fixing the diagnostic. Neither changes the application's review status.</Paragraph></Card>
    </>}
  </div>;
}
export function ScreenshotReviewHistory({client,apiBaseUrl,applicationId}) {
  const [data,setData]=useState([]),[error,setError]=useState("");
  useEffect(()=>{let alive=true;screenshotReviewRequest(client,apiBaseUrl,"history",{id:applicationId}).then(r=>{if(alive)setData(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[client,apiBaseUrl,applicationId]);
  return <Card title="AI Screenshot Review History">{error&&<Alert type="error" message={error}/>}
    <Table rowKey="id" dataSource={data} pagination={{pageSize:10}} columns={[
      {title:"Date",render:(_,r)=>new Date(r.created_at).toLocaleString()}, {title:"AI result",dataIndex:"status",render:statusTag},
      {title:"Model / prompt",render:(_,r)=>`${r.model} / ${r.prompt_version}`},{title:"Diagnostic",dataIndex:"diagnostic"},
      {title:"Batch",render:(_,r)=><a href={`#/screenshot-review-batches/${r.batch_id}`}>Guide and review details</a>},
    ]} expandable={{rowExpandable:r=>Boolean(r.result),expandedRowRender:r=><FieldResults result={r.result}/>}}/>
  </Card>;
}
