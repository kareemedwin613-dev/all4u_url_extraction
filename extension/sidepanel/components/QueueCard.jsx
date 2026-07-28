import React from "react";
import { Button, Card, Space, Tag, Typography } from "antd";

const { Text } = Typography;

export function QueueCard({ job, onOpen, onViewMatch, onViewJob, onCancel }) {
  const jd = job.job_descriptions || {};
  const resume = job.resumes || {};
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Text strong>
        {jd.company || "Unknown"} — {jd.job_title || "Job"}
      </Text>
      <div>
        <Text type="secondary">
          {resume.candidate_name || "Candidate"} · {resume.resume_name || "Resume"}
        </Text>
      </div>
      <div style={{ margin: "6px 0" }}>
        <Text strong>{job.match_score}/100</Text> <Tag>{job.status}</Tag>{" "}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(job.created_at).toLocaleString()}
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        {job.review_notes || "No review notes"}
      </Text>
      <Space wrap>
        <Button size="small" onClick={onOpen}>
          Open source
        </Button>
        <Button size="small" onClick={onViewMatch}>
          View match explanation
        </Button>
        <Button size="small" onClick={onViewJob}>
          Open JD details
        </Button>
        {job.status === "PENDING" && (
          <Button size="small" danger onClick={onCancel}>
            Cancel
          </Button>
        )}
      </Space>
    </Card>
  );
}
