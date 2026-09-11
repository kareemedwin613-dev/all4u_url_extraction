import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import { getApplicationMatchComparison, requestApplicationMatchComparison } from "../applications/application-service.js";
import { MatchingRunnerCommand } from "./match-components.jsx";
import { startMatchPreviewPolling, previewFailureMessage } from "./preview-polling.js";
import { COMPARISON_DIMENSIONS, comparisonPending, comparisonNeedsEvaluation, comparisonDifference, comparisonScoreLabel } from "./comparison-state.js";
import { formatDate } from "../../shared/formatters.js";

export function ApplicationScoreComparison({ client, apiBaseUrl, applicationId, resumeId, manager }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [actionError, setActionError] = useState(""),
    [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [runner, setRunner] = useState(null);
  const scope = `${apiBaseUrl}|${applicationId}|${resumeId}`;
  useEffect(() => { setData(null); setRunner(null); setError(""); setActionError(""); }, [scope]);
  useEffect(() => startMatchPreviewPolling({
    load: () => getApplicationMatchComparison(client, apiBaseUrl, applicationId), shouldPoll: comparisonPending,
    onSuccess: value => { setData(value); setError(""); },
    onError: (cause, delay) => setError(previewFailureMessage(cause, delay)),
  }), [client, scope, refresh]);
  async function evaluate() {
    setBusy(true); setActionError("");
    try {
      const result = await requestApplicationMatchComparison(client, apiBaseUrl, applicationId);
      setRunner(result.runner ? { ...result.runner, scope } : null); setRefresh(value => value + 1);
    } catch (cause) { setActionError(cause.message); }
    finally { setBusy(false); }
  }
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
      tailored: data.tailored ? data.tailored.reason || "No explanation available yet." : "Tailor this resume to compare." },
    ...COMPARISON_DIMENSIONS.map(([key, label]) => ({ key, label, original: rating(data.original, key), tailored: rating(data.tailored, key) })),
    { key: "evaluated", label: "Evaluated", original: data.original?.scoredAt ? formatDate(data.original.scoredAt) : "—", tailored: data.tailored?.scoredAt ? formatDate(data.tailored.scoredAt) : "—" },
  ] : [];
  return <Card title="Resume match comparison" extra={<Button onClick={() => setRefresh(value => value + 1)}>Refresh scores</Button>}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {(error || actionError) && <Alert type="warning" showIcon message={actionError || error}
        description={error && data ? "The displayed scores are from the last successful read." : undefined} />}
      {!data && !error && <Typography.Text>Loading match scores…</Typography.Text>}
      {data && <>
        <Table size="small" pagination={false} rowKey="key" dataSource={rows} scroll={{ x: 560 }}
          columns={[{ title: "", dataIndex: "label", width: 170 }, { title: "Original resume", dataIndex: "original" }, { title: "Tailored resume", dataIndex: "tailored" }]} />
        {difference !== null ? <Tag color={difference > 0 ? "green" : difference < 0 ? "orange" : "blue"}>
          JD alignment: {difference > 0 ? "+" : ""}{difference} points after tailoring
        </Tag> : data.tailored && <Typography.Text type="secondary">The difference appears when both scores are complete for the current JD and scoring configuration.</Typography.Text>}
        {data.creationScore != null && <Typography.Text type="secondary">
          Original eligibility score saved at creation: {data.creationScore}/100 (threshold {data.creationThreshold}). {data.creationReason}
        </Typography.Text>}
        {data.matchingMode === "CATEGORY" && <Typography.Text type="secondary">Created by category/subcategory matching; no AI eligibility score was required.</Typography.Text>}
        <Typography.Text type="secondary">Scores measure alignment of the resume text with the JD, not independently verified experience. Original and tailored versions use the same scoring rubric.</Typography.Text>
        {manager && <Button onClick={evaluate} loading={busy} disabled={!comparisonNeedsEvaluation(data)}>Evaluate / resume comparison</Button>}
        {manager && !data.matchingConfigured && <Alert type="info" message="Configure the scoring model before evaluating these resumes." />}
      </>}
      {manager && runner?.scope === scope && <MatchingRunnerCommand runner={runner} apiBaseUrl={apiBaseUrl} />}
    </Space>
  </Card>;
}
