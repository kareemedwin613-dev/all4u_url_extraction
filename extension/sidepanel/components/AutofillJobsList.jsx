import React from "react";
import { Button, Card, Space, Tag, Typography } from "antd";

const { Text } = Typography;

// One line per Application running in another tab: where it is, and whether it needs the Applier.
export function jobState(job) {
  if (job.phase === "failed") return { color: "error", label: "Stopped" };
  if (job.busy) return { color: "processing", label: job.phase === "scanning" ? "Scanning" : job.phase === "filling" ? "Filling" : "Starting" };
  if (job.deferredFieldIds?.length || job.attention) return { color: "warning", label: "Needs you" };
  if (job.session?.action === "LOAD_RESUME") return job.attachment?.status === "ATTACHED" ? { color: "success", label: "Attached" } : { color: "warning", label: "Needs you" };
  return { color: "success", label: "Done" };
}

export function AutofillJobsList({ jobs, onOpen, onDismiss }) {
  if (!jobs.length) return null;
  return (
    <Card size="small" title={`Other tabs (${jobs.length})`} style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {jobs.map((job) => {
          const state = jobState(job), company = job.context?.job?.company, title = job.context?.job?.jobTitle;
          let host = "";
          try { host = new URL(job.session.targetUrl).hostname; } catch { /* no URL */ }
          return (
            <div key={job.session.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Tag color={state.color} style={{ marginTop: 2 }}>{state.label}</Tag>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong ellipsis style={{ display: "block" }}>{company ? `${company}${title ? ` — ${title}` : ""}` : host || "Job page"}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{job.error || job.summary || (job.busy ? "Working…" : "")}</Text>
              </div>
              <Space size={4}>
                <Button size="small" onClick={() => onOpen(job)}>Open tab</Button>
                <Button size="small" type="text" disabled={job.busy} onClick={() => onDismiss(job)}>Dismiss</Button>
              </Space>
            </div>
          );
        })}
      </Space>
    </Card>
  );
}
