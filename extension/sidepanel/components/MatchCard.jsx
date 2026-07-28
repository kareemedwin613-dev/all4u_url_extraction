import React from "react";
import { Card, Checkbox, Tag, Typography } from "antd";

const { Text } = Typography;

export function MatchCard({ match, checked, onToggle }) {
  const { resume, details } = match;
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Checkbox checked={checked} onChange={(event) => onToggle(resume.id, event.target.checked)}>
        <Text strong>
          {resume.candidate_name} — {resume.resume_name}
        </Text>
      </Checkbox>
      <div style={{ marginTop: 6 }}>
        <Text strong style={{ fontSize: 16 }}>
          {details.total}/100
        </Text>{" "}
        <Tag color={details.eligible ? "green" : "default"}>
          {details.eligible ? "Eligible" : "Below threshold"}
        </Tag>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
        Category 50/50 · Subcategory {details.subcategory.points}/20 ({details.subcategory.reason}) · Seniority{" "}
        {details.seniority.points}/15 ({details.seniority.compatibility}) · Skills {details.skills.points}/15
      </Text>
      <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
        Matched: {details.skills.matchedSkills.join(", ") || "None"}. Missing:{" "}
        {details.skills.missingSkills.join(", ") || "None"}.
      </Text>
    </Card>
  );
}
