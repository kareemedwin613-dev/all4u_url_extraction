import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import { getApplicationMatchComparison } from "../applications/application-service.js";
import { startMatchPreviewPolling, previewFailureMessage } from "./preview-polling.js";
import { COMPARISON_DIMENSIONS, comparisonDifference, comparisonScoreLabel } from "./comparison-state.js";
import { formatDate } from "../../shared/formatters.js";

export function ApplicationScoreComparison({ client, apiBaseUrl, applicationId, resumeId }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  const scope = `${apiBaseUrl}|${applicationId}|${resumeId}`;
  useEffect(() => { setData(null); setError(""); }, [scope]);
  useEffect(() => startMatchPreviewPolling({
    load: () => getApplicationMatchComparison(client, apiBaseUrl, applicationId), shouldPoll: () => false,
    onSuccess: value => { setData(value); setError(""); },
    onError: (cause, delay) => setError(previewFailureMessage(cause, delay)),
  }), [client, scope, refresh]);
  const difference = comparisonDifference(data);
  const score = value => <Space direction="vertical" size={4}>
    <Typography.Text strong>{comparisonScoreLabel(value)}</Typography.Text>
    {value && <Typography.Text type="secondary">Resume #{value.resumeNumber} · {value.resumeName}</Typography.Text>}
    {value?.status === "STALE" && <Tag color="orange">Source or scoring configuration changed</Tag>}
    {value?.errorCode && <Typography.Text type="secondary">{value.errorCode}</Typography.Text>}
  </Space>;
  const rating = (value, key) => {
    if (!value || !["COMPLETED", "STALE"].includes(value.status) || !Number.isInteger(value.score)) return "—";
    const number = value.components?.[key]?.rating;
    return Number.isInteger(number) ? `${number}/100` : "Not requested by JD";
  };
  const rows = data ? [
    { key: "score", label: "Match score", original: score(data.original), tailored: score(data.tailored) },
    { key: "reason", label: "Reason", original: data.original?.reason || "No explanation available yet.",
      tailored: data.tailored ? data.tailored.reason || "No explanation recorded." : "No historical tailored evaluation." },
    ...COMPARISON_DIMENSIONS.map(([key, label]) => ({ key, label, original: rating(data.original, key), tailored: rating(data.tailored, key) })),
    { key: "evaluated", label: "Evaluated", original: data.original?.scoredAt ? formatDate(data.original.scoredAt) : "—", tailored: data.tailored?.scoredAt ? formatDate(data.tailored.scoredAt) : "—" },
  ] : [];
  return <Card title="Archived resume match comparison" extra={<Button onClick={() => setRefresh(value => value + 1)}>Refresh history</Button>}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert type="info" message="AI evaluation is archived. These scores are historical and do not control new Applications." />
      {error && <Alert type="warning" showIcon message={error}
        description={error && data ? "The displayed scores are from the last successful read." : undefined} />}
      {!data && !error && <Typography.Text>Loading match scores…</Typography.Text>}
      {data && <>
        <Table size="small" pagination={false} rowKey="key" dataSource={rows} scroll={{ x: 560 }}
          columns={[{ title: "", dataIndex: "label", width: 170 }, { title: "Original resume", dataIndex: "original" }, { title: "Tailored resume", dataIndex: "tailored" }]} />
        {difference !== null ? <Tag color={difference > 0 ? "green" : difference < 0 ? "orange" : "blue"}>
          JD alignment: {difference > 0 ? "+" : ""}{difference} points after tailoring
        </Tag> : data.tailored && <Typography.Text type="secondary">No comparable completed score pair is available. Evaluation is archived.</Typography.Text>}
        {data.creationScore != null && <Typography.Text type="secondary">
          Original eligibility score saved at creation: {data.creationScore}/100 (threshold {data.creationThreshold}). {data.creationReason}
        </Typography.Text>}
        {data.matchingMode === "CATEGORY" && <Typography.Text type="secondary">Created by category/subcategory matching; no AI eligibility score was required.</Typography.Text>}
        <Typography.Text type="secondary">Scores measure alignment of the resume text with the JD, not independently verified experience. Original and tailored versions use the same scoring rubric.</Typography.Text>
      </>}
    </Space>
  </Card>;
}
