import React, { useEffect, useState } from "react";
import { Alert, Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import { previewBulkApplications, requestApplicationMatches, revokeMatchingRunner } from "../bulk-applications/bulk-service.js";
import { canRunMatch, hasPendingMatches, MATCHING_MODES } from "./match-state.js";
import { matchingRunnerCommand } from "./runner-command.js";
import { startMatchPreviewPolling, previewFailureMessage } from "./preview-polling.js";

export function MatchingModeSelect({ value, onChange, disabled }) {
  return <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
    <Typography.Text strong>Matching method</Typography.Text>
    <Select aria-label="Matching method" value={value} onChange={onChange} disabled={disabled}
      options={MATCHING_MODES} style={{ width: "100%", maxWidth: 520 }} />
  </Space>;
}

export function MatchingRunnerCommand({ runner, apiBaseUrl, onRevoke, busy }) {
  const command = matchingRunnerCommand(runner, apiBaseUrl);
  if (!command) return null;
  return <Alert type="success" showIcon message={`Scoring command ready — ${runner.pairCount} pair(s)`} style={{ marginTop: 12 }}
    description={<><Typography.Paragraph copyable={{ text: command }} code style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</Typography.Paragraph>
      <Typography.Paragraph>Run from the repository root, like tailoring. Start within 15 minutes; the runner stays active for up to 8 hours and stops when this selection finishes. No Supabase key is needed. Keep this command private.</Typography.Paragraph>
      {onRevoke && <Button size="small" loading={busy} onClick={onRevoke}>Revoke this command</Button>}</>} />;
}

const labels = { requiredSkills: "Required skills", preferredSkills: "Preferred skills", responsibilities: "Responsibilities", seniority: "Seniority", domain: "Role/domain" };
export function MatchScore({ row }) {
  if (row?.matchingMode === "CATEGORY") return <Tag color={row.eligible ? "green" : "default"}>Category match · No AI</Tag>;
  const score = row?.matchScore;
  const detail = <div>
    {row?.matchSummary && <p>{row.matchSummary}</p>}
    {Object.entries(row?.matchBreakdown || {}).map(([key, value]) => <div key={key}>{labels[key] || key}: {value == null ? "Not requested" : `${value}/100`}</div>)}
    {!!row?.missingRequirements?.length && <p>Gaps: {row.missingRequirements.join("; ")}</p>}
    {row?.exclusionReason && <p>{row.exclusionReason}</p>}
  </div>;
  return <Tooltip title={detail}><Tag color={score == null ? "default" : score >= row.matchThreshold ? "green" : "orange"}>
    {score == null ? (row?.matchStatus || "NOT_ASSESSED").replaceAll("_", " ") : `${score}/100`}
  </Tag></Tooltip>;
}

export function ApplicationMatchPanel({ client, apiBaseUrl, jobId, resumeId, matchingMode = "SCORE", onEligibilityChange }) {
  const [row, setRow] = useState(null), [error, setError] = useState(""), [previewError, setPreviewError] = useState(""), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [runner, setRunner] = useState(null);
  const scope = `${apiBaseUrl}|${jobId}|${resumeId}|${matchingMode}`;
  useEffect(() => {
    setRow(null); setError(""); setPreviewError(""); onEligibilityChange(false);
    if (!jobId || !resumeId) return;
    return startMatchPreviewPolling({
      load: () => previewBulkApplications(client, apiBaseUrl, [jobId], [resumeId], matchingMode),
      shouldPoll: preview => matchingMode === "SCORE" && hasPendingMatches(preview.combinations || []),
      onSuccess: preview => {
        const match = preview.combinations?.[0];
        setRow(match || null); onEligibilityChange(match?.eligible === true);
        setPreviewError(match ? "" : matchingMode === "CATEGORY"
          ? "This pair is unavailable under the category/subcategory rules, or the JD/Resume is no longer active and approved."
          : "This pair is unavailable: the JD must be active and approved with a valid primary category, and the original Resume must share that primary category.");
      },
      onError: (cause, retryDelayMs) => { setPreviewError(previewFailureMessage(cause, retryDelayMs)); onEligibilityChange(false); },
    });
  }, [client, apiBaseUrl, jobId, resumeId, matchingMode, refresh, onEligibilityChange]);
  async function request() {
    if (matchingMode !== "SCORE") return;
    setBusy(true); setError("");
    try { const value = await requestApplicationMatches(client, apiBaseUrl, [{ jobDescriptionId: jobId, resumeId }], true); setRunner(value.runner ? { ...value.runner, scope } : null); setRefresh(value => value + 1); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError("");
    try { await revokeMatchingRunner(client, apiBaseUrl, runner.ticketId); setRunner(null); setRefresh(value => value + 1); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  if (!jobId || !resumeId) return null;
  return <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
    {previewError && <Alert type="warning" showIcon message={previewError} />}
    {error && <Alert type="error" showIcon message={error} />}
    {row && <><Space><MatchScore row={row} />{matchingMode === "SCORE" && <span>Minimum score: {row.matchThreshold}</span>}</Space>
      {matchingMode === "CATEGORY" && row.eligible && <Alert type="success" message="Eligible by category/subcategory. You can create this Application now; no AI evaluation is required." />}
      {row.matchSummary && <div>{row.matchSummary}</div>}
      {!row.eligible && <Alert type="info" message={row.exclusionReason} />}</>}
    <Space>{matchingMode === "SCORE" && <Button onClick={request} loading={busy} disabled={!canRunMatch(row)}>Create / resume scoring command</Button>}
      <Button onClick={() => setRefresh(value => value + 1)}>Refresh {matchingMode === "SCORE" ? "score" : "eligibility"}</Button></Space>
    {matchingMode === "SCORE" && runner?.scope === scope && <MatchingRunnerCommand runner={runner} apiBaseUrl={apiBaseUrl} onRevoke={revoke} busy={busy} />}
  </Space>;
}
