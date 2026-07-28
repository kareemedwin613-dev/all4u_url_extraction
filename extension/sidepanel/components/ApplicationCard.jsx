import React from "react";
import { Badge, Button, Card, Flex, Space, Tag, Typography } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import { normalizeUrl } from "../../shared/normalization.js";

const { Text } = Typography;

const STATUS_COLORS = {
  NOT_APPLIED: "default",
  APPLIED: "blue",
  SCREENING: "gold",
  INTERVIEW_SCHEDULED: "purple",
  OFFER_RECEIVED: "green",
  REJECTED: "red",
  WITHDRAWN: "default",
  CLOSED: "default",
};

export function ApplicationCard({ application, onUpdateStatus }) {
  const jobUrl = normalizeUrl(application.source_url);
  const applicationUrl = normalizeUrl(application.application_url);
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
        <Text>{application.resume_name || "Unnamed Resume"}</Text>
        {application.candidate_name && <Text type="secondary"> · {application.candidate_name}</Text>}
      </div>
      <Space wrap style={{ margin: "4px 0" }}>
        <Tag color={STATUS_COLORS[application.application_status] || "default"}>
          {String(application.application_status || "").replaceAll("_", " ")}
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
        <Button size="small" onClick={() => onUpdateStatus(application)}>
          Update Status
        </Button>
      </div>
    </Card>
  );
}
