import React, { useMemo } from "react";
import { Alert, Button, Card, Col, Flex, Progress, Row, Space, Statistic, Tag, Typography } from "antd";
import { matchEvaluationState, matchingProgress, matchingTimingItems } from "./match-progress.js";
import { useBatchTimeEstimate } from "../../shared/use-batch-time-estimate.js";
import { BatchTimeEstimate } from "../../shared/batch-time-estimate.jsx";

const labels = {
  EMPTY: "No scoring candidates", NOT_STARTED: "Awaiting evaluation", QUEUED: "Queued", PROCESSING: "Processing",
  COMPLETED: "Evaluation complete", FINISHED_WITH_ISSUES: "Finished with issues",
};
const stateColors = { COMPLETED: "green", PROCESSING: "blue", PENDING: "gold", FAILED: "red", INSUFFICIENT_DATA: "orange", STALE: "orange" };
const stateLabels = { COMPLETED: "Completed", PROCESSING: "Processing", PENDING: "Queued", FAILED: "Failed", INSUFFICIENT_DATA: "Insufficient data", STALE: "Needs rescore", NOT_ASSESSED: "Not started", SKIPPED: "Skipped" };

export function MatchEvaluationStatus({ row }) {
  const state = matchEvaluationState(row);
  return <Space direction="vertical" size={0}>
    <Tag color={stateColors[state]}>{stateLabels[state]}</Tag>
    {["FAILED", "INSUFFICIENT_DATA"].includes(state) && row.matchErrorCode && <Typography.Text type="danger" code>{row.matchErrorCode}</Typography.Text>}
  </Space>;
}

export function MatchingProgress({ scope, rows, truncated, lastUpdated, stale, refreshing, onRefresh }) {
  const progress = matchingProgress(rows);
  const timingItems = useMemo(() => matchingTimingItems(rows), [rows]);
  const estimate = useBatchTimeEstimate({ scope, items: timingItems, updatedAt: lastUpdated, unavailable: stale || refreshing, incomplete: truncated });
  const uncertain = stale || refreshing || truncated;
  const tagLabel = stale ? "Updates unavailable" : refreshing ? "Updating selection" : truncated ? "Partial preview" : labels[progress.status];
  const color = uncertain ? "gold" : progress.status === "COMPLETED" ? "green" : progress.status === "FINISHED_WITH_ISSUES" ? "red" : progress.processing ? "blue" : "default";
  const barStatus = uncertain ? "normal" : progress.status === "FINISHED_WITH_ISSUES" ? "exception" : progress.status === "COMPLETED" ? "success" : progress.processing || progress.queued ? "active" : "normal";
  return <Card title="Evaluation progress" style={{ marginBottom: 16 }} extra={<Button onClick={onRefresh}>Refresh progress</Button>}>
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Tag color={color}>{tagLabel}</Tag>
        <Typography.Text role="status" aria-live="polite">
          {progress.finished} / {progress.total} finished · {progress.remaining} remaining{truncated ? " (displayed pairs only)" : ""}
        </Typography.Text>
      </Flex>
      {!truncated && <Progress aria-label="Evaluation progress" percent={progress.percent} status={barStatus} />}
      <BatchTimeEstimate estimate={estimate} unit="JD/resume pair" />
      <Row gutter={[12, 12]} style={{ width: "100%" }}>
        {[["Completed", progress.completed], ["Processing", progress.processing], ["Queued", progress.queued],
          ["Eligible", progress.eligible], ["Not eligible", progress.notEligible], ["Failed", progress.failed]].map(([title, value]) =>
          <Col xs={12} md={8} xl={4} key={title}><Statistic title={title} value={value} /></Col>)}
      </Row>
      <Typography.Text type="secondary">
        {progress.skipped} duplicate/blocked pairs excluded from progress.
        {" "}Not eligible includes below-threshold and insufficient-data results, not pending or failed evaluations.
        {" "}Unevaluated pairs remain in the remaining total. Finished includes failures.
      </Typography.Text>
      {truncated && <Alert type="warning" showIcon message="Narrow the JD or Resume selection to see complete progress. This preview does not contain every pair." />}
      {(stale || refreshing) && <Typography.Text type="warning">{stale ? "The last refresh failed; these counts may be out of date." : "Loading the selected resumes; these counts may be incomplete."}</Typography.Text>}
      <Typography.Text type="secondary">
        Covers the selected JDs and Resumes, including existing current scores, regardless of table filters or checked rows.
        {" "}Refreshes every 5 seconds while evaluations are queued or processing. Updated batch commands run in the background; keep the computer awake. These are server-reported job states, not a worker connection check.
        {lastUpdated ? ` Last updated: ${new Date(lastUpdated).toLocaleTimeString()}.` : ""}
      </Typography.Text>
    </Space>
  </Card>;
}
