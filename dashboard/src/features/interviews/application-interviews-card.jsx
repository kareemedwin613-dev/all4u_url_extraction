import React, { useEffect, useState } from "react";
import { Button, Card, Space, Tag, Typography } from "antd";
import { INTERVIEW_STAGES, INTERVIEW_STATUSES, formatWhen, labelFor } from "./interview-model.js";
import { listInterviews } from "./interview-service.js";

const { Text } = Typography;
const STATUS_COLOR = { UPCOMING: "green", COMPLETED: "default", REJECTED: "red", NOT_JOINED: "volcano", RESCHEDULED: "gold", NEEDS_FOLLOW_UP: "orange" };

export function ApplicationInterviewsCard({ client, apiBaseUrl, applicationId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setItems(null);
    setError("");
    listInterviews(client, apiBaseUrl, { applicationId })
      .then((data) => {
        if (active) setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((caught) => {
        if (!active) return;
        setItems([]);
        setError(caught.message || "Interviews could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [client, apiBaseUrl, applicationId]);
  return (
    <Card
      title="Interviews"
      extra={<Button type="primary" href={`#/calendar?application=${applicationId}`}>Add interview</Button>}
    >
      {error ? <Text type="danger">{error}</Text> : null}
      {items == null ? <Text type="secondary">Loading interviews…</Text> : null}
      {items && !items.length && !error ? <Text type="secondary">No interviews recorded for this Application.</Text> : null}
      <Space direction="vertical" style={{ width: "100%" }}>
        {(items || []).map((item) => (
          <div key={item.id}>
            <a href={`#/calendar?interview=${item.id}`}>{formatWhen(item.startsAt, item.endsAt)}</a>
            {" · "}
            {labelFor(INTERVIEW_STAGES, item.stage)}
            {" "}
            <Tag color={STATUS_COLOR[item.status]}>{labelFor(INTERVIEW_STATUSES, item.status)}</Tag>
          </div>
        ))}
      </Space>
    </Card>
  );
}
