import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Input, Modal, Select, Space, Tag, Typography } from "antd";
import { CheckOutlined, CloseOutlined, EditOutlined, ExportOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { listJobCapturers, listJobReviews, reviewJob } from "../../services/job-review-service.js";

const { Text, Title } = Typography;
const REVIEW_OPTIONS = [
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "NEEDS_CORRECTION", label: "Needs Correction" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
  { value: "ALL", label: "All Statuses" },
];
const DECLINE_OPTIONS = [
  { value: "EXPIRED", label: "Expired" }, { value: "NOT_ELIGIBLE", label: "Not eligible" },
  { value: "DUPLICATE", label: "Duplicate" }, { value: "INVALID_URL", label: "Invalid URL" }, { value: "OTHER", label: "Other" },
];

function rangeFor(value) {
  if (value === "ALL") return {};
  const now = new Date(), from = new Date(now);
  if (value === "TODAY") from.setHours(0, 0, 0, 0);
  if (value === "THREE_DAYS") from.setDate(from.getDate() - 3);
  if (value === "WEEK") { const day = (from.getDay() + 6) % 7; from.setDate(from.getDate() - day); from.setHours(0, 0, 0, 0); }
  if (value === "MONTH") { from.setDate(1); from.setHours(0, 0, 0, 0); }
  return { capturedFrom: from.toISOString(), capturedTo: new Date(now.getTime() + 1000).toISOString() };
}

async function openPosting(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("The job posting URL is invalid.");
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id) await chrome.tabs.update(active.id, { url: parsed.toString(), active: true });
  else await chrome.tabs.create({ url: parsed.toString(), active: true });
}

export function JobReviewView({ client, backendBaseUrl, onStatus, onError }) {
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [capturers, setCapturers] = useState([]), [index, setIndex] = useState(0);
  const [reviewStatus, setReviewStatus] = useState("NEEDS_REVIEW"), [windowValue, setWindowValue] = useState("ALL"), [capturer, setCapturer] = useState("");
  const [busy, setBusy] = useState(false), [dialog, setDialog] = useState(null), [comment, setComment] = useState(""), [reason, setReason] = useState("EXPIRED");
  const current = items[index] || null;

  const activeFilters=useCallback(()=>({ reviewStatus, capturedByUserId: capturer, ...rangeFor(windowValue) }),[reviewStatus,capturer,windowValue]);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [result, people] = await Promise.all([
        listJobReviews(client, backendBaseUrl, activeFilters()),
        listJobCapturers(client, backendBaseUrl),
      ]);
      setItems(result?.items || []); setTotal(Number(result?.total)||0); setCapturers(people || []); setIndex(0);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }, [client, backendBaseUrl, activeFilters, onError]);

  useEffect(() => { load(); }, [load]);
  const capturerOptions = useMemo(() => [{ value: "", label: "All finders" }, ...capturers.map((person) => ({ value: person.id, label: person.displayName || person.email }))], [capturers]);

  async function decide(nextStatus, declineReason, note) {
    if (!current) return;
    setBusy(true);
    try {
      await reviewJob(client, backendBaseUrl, current.id, { reviewStatus: nextStatus, ...(declineReason ? { declineReason } : {}), ...(note.trim() ? { comment: note.trim() } : {}) });
      onStatus({ kind: "success", message: nextStatus === "APPROVED" ? "JD approved." : nextStatus === "DECLINED" ? "JD declined." : "Correction requested." });
      setDialog(null); setComment("");
      const remaining = items.filter((item) => item.id !== current.id),leavesView=reviewStatus!=="ALL"&&nextStatus!==reviewStatus;
      if(remaining.length){setItems(remaining);setTotal(value=>Math.max(0,value-(leavesView?1:0)));setIndex(Math.min(index,remaining.length-1));}
      else{
        const refreshed=await listJobReviews(client,backendBaseUrl,activeFilters());
        setItems(refreshed?.items||[]);setTotal(Number(refreshed?.total)||0);setIndex(0);
      }
    } catch (error) { onError(error); } finally { setBusy(false); }
  }

  return <Space orientation="vertical" size={12} style={{ width: "100%" }}>
    <div><Title level={4} style={{ marginBottom: 0 }}>Review JDs</Title><Text type="secondary">Open, decide, and move to the next item.</Text></div>
    <Card size="small">
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Select aria-label="Review status" value={reviewStatus} onChange={setReviewStatus} options={REVIEW_OPTIONS} style={{ width: "100%" }} />
        <Flex gap={8}><Select aria-label="Captured time" value={windowValue} onChange={setWindowValue} options={[{value:"TODAY",label:"Today"},{value:"THREE_DAYS",label:"Last 3 days"},{value:"WEEK",label:"This week"},{value:"MONTH",label:"This month"},{value:"ALL",label:"Any time"}]} style={{ flex: 1 }} /><Select aria-label="Captured by" value={capturer} onChange={setCapturer} options={capturerOptions} style={{ flex: 1 }} /></Flex>
      </Space>
    </Card>
    <Alert type="info" showIcon message={`${total} JD${total === 1 ? "" : "s"} match this view`} description={total>items.length?`Reviewing ${items.length} at a time; the next batch loads automatically.`:undefined} />
    {!current ? <Card loading={busy}><Empty description="No JDs match these filters" /></Card> : <Card loading={busy} title={<span>{current.company} — {current.job_title}</span>} extra={<Tag>{String(current.review_status || "").replaceAll("_", " ")}</Tag>}>
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Flex gap={6} wrap="wrap"><Tag color="blue">{current.category_name || "Uncategorized"}</Tag><Text>{current.location_text || "Location not specified"}</Text></Flex>
        <Text type="secondary">Found by {current.captured_by?.display_name || current.captured_by?.email || "Unknown"} · {new Date(current.created_at).toLocaleString()}</Text>
        {current.review_comment && <Alert type="warning" message={current.review_comment} />}
        <Button block icon={<ExportOutlined />} onClick={() => openPosting(current.source_url).catch(onError)}>Open job posting</Button>
        <Button block type="primary" icon={<CheckOutlined />} onClick={() => decide("APPROVED", null, "")}>Approve & next</Button>
        <Flex gap={8}><Button style={{ flex: 1 }} icon={<EditOutlined />} onClick={() => setDialog("CORRECTION")}>Needs Correction</Button><Button danger style={{ flex: 1 }} icon={<CloseOutlined />} onClick={() => setDialog("DECLINE")}>Decline</Button></Flex>
        <Flex justify="space-between" align="center"><Button icon={<LeftOutlined />} disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</Button><Text>{index + 1} of {items.length}</Text><Button icon={<RightOutlined />} disabled={index >= items.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</Button></Flex>
      </Space>
    </Card>}
    <Modal open={dialog === "CORRECTION"} title="Request correction" okText="Save & next" confirmLoading={busy} onCancel={() => setDialog(null)} onOk={() => decide("NEEDS_CORRECTION", null, comment)}><Input.TextArea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={4} placeholder="Optional note for the JD Finder" /></Modal>
    <Modal open={dialog === "DECLINE"} title="Decline JD" okText="Decline & next" okButtonProps={{ danger: true }} confirmLoading={busy} onCancel={() => setDialog(null)} onOk={() => decide("DECLINED", reason, comment)}><Space orientation="vertical" style={{ width: "100%" }}><Select value={reason} onChange={setReason} options={DECLINE_OPTIONS} style={{ width: "100%" }} /><Input.TextArea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={4} placeholder="Optional comment" /></Space></Modal>
  </Space>;
}
