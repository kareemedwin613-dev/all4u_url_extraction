import React from "react";
import { Badge, Button, Card, Flex, Space, Tag, Typography } from "antd";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import { normalizeUrl } from "../../shared/normalization.js";

const { Text } = Typography;

const STATUS_COLORS = {
  ASSIGNED: "default",
  IN_PROGRESS: "processing",
  BLOCKED: "warning",
  APPLIED: "blue",
  SCREENING: "gold",
  INTERVIEW_SCHEDULED: "purple",
  OFFER_RECEIVED: "green",
  REJECTED: "red",
  WITHDRAWN: "default",
  CLOSED: "default",
  CANCELLED: "default",
};

export function ApplicationCard({ application, onUpdateStatus, onExtensionAction, onDownloadResume, extensionBusy }) {
  const jobUrl = normalizeUrl(application.source_url);
  const applicationUrl = normalizeUrl(application.application_url);
  const extensionEligible = Boolean(jobUrl && application.resume_id && !["APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED","CANCELLED"].includes(application.status));
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Flex justify="space-between" align="start" gap={8}>
        <Text strong>
          {application.company} — {application.job_title}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          #{application.application_number ?? "—"}
        </Text>
      </Flex>
      <div style={{ margin: "4px 0" }}>
        <Text>{application.resume_number ? `Resume #${application.resume_number} · ` : ""}{application.resume_name || "Unnamed Resume"}</Text>
        {application.candidate_name && <Text type="secondary"> · {application.candidate_name}</Text>}
        {application.resume_type && <Tag color={application.resume_type === "TAILORED" ? "purple" : "default"} style={{ marginInlineStart: 6 }}>{application.resume_type === "TAILORED" ? "Tailored" : "Original"}</Tag>}
      </div>
      <Space wrap style={{ margin: "4px 0" }}>
        <Tag color={STATUS_COLORS[application.status] || "default"}>
          {String(application.status || "").replaceAll("_", " ")}
        </Tag>
        {application.category_name && <Tag>{application.category_name}</Tag>}
        {application.screenshot_count > 0 && (
          <Badge count={application.screenshot_count} size="small" color="#5cadff">
            <Tag icon={<PaperClipOutlined />}>Screenshots</Tag>
          </Badge>
        )}
      </Space>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Captured {application.captured_at ? new Date(application.captured_at).toLocaleDateString() : "—"}
        </Text>
      </div>
      <Space style={{ marginTop: 8 }} wrap>
        {jobUrl && (
          <a href={jobUrl} target="_blank" rel="noopener noreferrer">
            Job posting
          </a>
        )}
        {applicationUrl && (
          <a href={applicationUrl} target="_blank" rel="noopener noreferrer">
            Application
          </a>
        )}
        {!jobUrl && !applicationUrl && <Text type="secondary">No link available</Text>}
      </Space>
      <div style={{ marginTop: 8 }}>
        <Space wrap>
          <Button size="small" onClick={() => onUpdateStatus(application)}>Update Status</Button>
          <Button size="small" icon={<DownloadOutlined />} disabled={!application.resume_id} loading={extensionBusy === `${application.id}:DOWNLOAD_RESUME`} onClick={() => onDownloadResume(application)}>Download Resume</Button>
          <Button size="small" type="primary" disabled={!extensionEligible} loading={extensionBusy === `${application.id}:AUTOFILL`} onClick={() => onExtensionAction(application,"AUTOFILL")}>Autofill</Button>
        </Space>
      </div>
    </Card>
  );
}
