import React from "react";
import { Button, Card, Space, Tag, Typography } from "antd";

const { Text } = Typography;

export function ResumeCard({ resume, categoryName, canWrite, onOpen, onEdit, onToggleStatus }) {
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Text strong>
        {resume.candidate_name} — {resume.resume_name}
      </Text>
      <div>
        <Text type="secondary">
          {categoryName || "Unknown"} · {resume.seniority} · {resume.status}
        </Text>
      </div>
      <div style={{ margin: "6px 0" }}>
        {resume.skills?.length ? (
          resume.skills.map((skill) => <Tag key={skill}>{skill}</Tag>)
        ) : (
          <Text type="secondary">No skills</Text>
        )}
      </div>
      <Space>
        <Button size="small" onClick={onOpen}>
          Open source
        </Button>
        {canWrite && (
          <Button size="small" onClick={onEdit}>
            Edit metadata
          </Button>
        )}
        {canWrite && (
          <Button size="small" onClick={onToggleStatus}>
            {resume.status === "ACTIVE" ? "Archive" : "Restore"}
          </Button>
        )}
      </Space>
    </Card>
  );
}
