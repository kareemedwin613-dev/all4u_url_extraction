import React from "react";
import { Badge, Button, Card, Flex, Space, Tag, Tooltip, Typography } from "antd";
import { CopyOutlined, DownloadOutlined, PaperClipOutlined, ThunderboltOutlined, WarningOutlined } from "@ant-design/icons";
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

function techStackLabels(application = {}) {
  const names = Array.isArray(application.resume_category_names)
    ? application.resume_category_names.filter(Boolean)
    : [];
  if (names.length) return names;
  return application.category_name ? [application.category_name] : [];
}

export function ApplicationCard({ application, onUpdateStatus, onExtensionAction, onDownloadResume, onDownloadCoverLetter, onCopyCoverLetter, onCopyQaPrompt, readyPromptId, extensionBusy, actionsEnabled = true }) {
  const jobUrl = normalizeUrl(application.source_url);
  const applicationUrl = normalizeUrl(application.application_url);
  const isTailored = application.resume_type === "TAILORED";
  const extensionEligible = Boolean(jobUrl && application.resume_id && !["APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED","CANCELLED"].includes(application.status));
  const actionTitle = actionsEnabled ? undefined : "Actions are available on the first application.";
  return (
    <Card
      size="small"
      className={isTailored ? "application-card application-card--tailored" : "application-card"}
      style={{ marginBottom: 8 }}
    >
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
        {application.resume_type && (
          isTailored ? (
            <Tag bordered={false} icon={<ThunderboltOutlined />} className="application-resume-tag application-resume-tag--tailored">
              Tailored
            </Tag>
          ) : (
            <Tag className="application-resume-tag application-resume-tag--original" style={{ marginInlineStart: 6 }}>
              Original
            </Tag>
          )
        )}
      </div>
      <Space wrap style={{ margin: "4px 0" }}>
        <Tag color={STATUS_COLORS[application.status] || "default"}>
          {String(application.status || "").replaceAll("_", " ")}
        </Tag>
        {techStackLabels(application).map((name) => (
          <Tag key={name}>{name}</Tag>
        ))}
        {application.screenshot_count > 0 && (
          <Badge count={application.screenshot_count} size="small" color="#5cadff">
            <Tag icon={<PaperClipOutlined />}>Screenshots</Tag>
          </Badge>
        )}
        {String(application.screenshot_feedback || "").trim() ? (
          <Tooltip
            title={
              <div style={{ maxWidth: 280, whiteSpace: "pre-wrap" }}>
                {String(application.screenshot_feedback).trim()}
              </div>
            }
          >
            <Tag color="warning" icon={<WarningOutlined />}>
              Feedback
            </Tag>
          </Tooltip>
        ) : null}
      </Space>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Created {application.created_at ? new Date(application.created_at).toLocaleDateString() : "—"}
          {" · "}
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
          <Button size="small" title={actionTitle} disabled={!actionsEnabled} onClick={() => onUpdateStatus(application)}>Update Status</Button>
          <Button size="small" title={actionTitle} icon={<PaperClipOutlined />} disabled={!actionsEnabled || !extensionEligible} loading={extensionBusy === `${application.id}:LOAD_RESUME`} onClick={() => onExtensionAction(application,"LOAD_RESUME")}>Attach Resume</Button>
          <Button size="small" title={actionTitle} icon={<DownloadOutlined />} disabled={!actionsEnabled || !application.resume_id} loading={extensionBusy === `${application.id}:DOWNLOAD_RESUME`} onClick={() => onDownloadResume(application)}>Download Resume</Button>
          {onDownloadCoverLetter && <Button size="small" title={actionTitle} icon={<DownloadOutlined />} disabled={!actionsEnabled || !application.resume_id} loading={extensionBusy === `${application.id}:DOWNLOAD_COVER_LETTER`} onClick={() => onDownloadCoverLetter(application)}>Download Cover Letter</Button>}
          {onCopyCoverLetter && <Button size="small" title={actionTitle} icon={<CopyOutlined />} disabled={!actionsEnabled || !application.resume_id || Boolean(extensionBusy)} loading={extensionBusy === `${application.id}:COPY_COVER_LETTER`} onClick={() => onCopyCoverLetter(application)}>Copy Cover Letter</Button>}
          {onCopyQaPrompt && <Button size="small" title={actionTitle||"Copies the attached Resume and JD with instructions for application questions. Contains candidate information; review before sharing."} icon={<CopyOutlined />} disabled={!actionsEnabled || !application.resume_id || Boolean(extensionBusy)} loading={extensionBusy === `${application.id}:COPY_QA_PROMPT`} onClick={() => onCopyQaPrompt(application)}>{readyPromptId === application.id ? "Copy prepared prompt" : "Copy Q&A Prompt"}</Button>}
          <Button size="small" title={actionTitle} type="primary" disabled={!actionsEnabled || !extensionEligible} loading={extensionBusy === `${application.id}:AUTOFILL`} onClick={() => onExtensionAction(application,"AUTOFILL")}>Autofill</Button>
        </Space>
      </div>
    </Card>
  );
}
