import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Progress, Space, Spin, Tag, Typography } from "antd";
import { DollarOutlined, RobotOutlined, SettingOutlined, SyncOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAutofillAiUsage } from "../../services/autofill-ai-usage-service.js";
import { formatOverviewDate } from "./overview-date.js";
import { OverviewChartCard, OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";
import { formatUsd, summarizeAiUsage } from "./ai-usage.js";
import { AiSettingsModal } from "./ai-settings-modal.jsx";
import { AiApplierAccessCard } from "./ai-applier-access.jsx";

const { Text } = Typography;
const STATUS = { ON: { color: "green", label: "On" }, OFF: { color: "default", label: "Off" }, NO_KEY: { color: "orange", label: "On, but the provider key is missing" } };

// Admin-only Overview section: what AI question recognition costs, and how much the learned table saves.
export function AiUsageSection({ client, apiBaseUrl, dateRange, dateLabel, overviewRefresh = 0 }) {
  const [report, setReport] = useState(null), [error, setError] = useState(""), [configuring, setConfiguring] = useState(false), [saved, setSaved] = useState(0);
  useEffect(() => {
    let live = true;
    getAutofillAiUsage(client, apiBaseUrl, dateRange || {})
      .then((value) => { if (live) { setReport(value); setError(""); } })
      .catch((value) => { if (live) setError(value?.message || "AI Autofill usage could not be loaded."); });
    return () => { live = false; };
  }, [client, apiBaseUrl, dateRange?.from, dateRange?.to, overviewRefresh, saved]);
  const summary = useMemo(() => summarizeAiUsage(report, dateRange), [report, dateRange?.from, dateRange?.to]);

  return (
    <OverviewSection title="AI Autofill Usage & Cost" description={`Question recognition${summary?.model ? ` with ${summary.providerLabel ? `${summary.providerLabel} ` : ""}${summary.model}` : ""} · ${dateLabel}`}>
      {/* The whole section is Admin-only; so is changing the settings. */}
      <Space style={{ marginBottom: 12 }}><Button icon={<SettingOutlined />} onClick={() => setConfiguring(true)}>Configure</Button></Space>
      {error ? <Alert type="warning" showIcon message="AI usage is not available yet" description={error} style={{ marginBottom: 16 }} />
        : !summary ? <Spin style={{ display: "block", margin: "16px 0" }} />
        : <AiUsageBody summary={summary} />}
      <AiApplierAccessCard client={client} apiBaseUrl={apiBaseUrl} dateRange={dateRange} dateLabel={dateLabel} refresh={overviewRefresh + saved} globallyOn={!summary || summary.status !== "OFF"} />
      <AiSettingsModal client={client} apiBaseUrl={apiBaseUrl} open={configuring} onClose={() => setConfiguring(false)} onSaved={() => setSaved((value) => value + 1)} />
    </OverviewSection>
  );
}

function AiUsageBody({ summary }) {
  const { totals, month } = summary, status = STATUS[summary.status];
  return (
    <>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space direction="vertical" size={2} style={{ minWidth: 260 }}>
            <Text strong>This month: {formatUsd(month.costMicroUsd)}{month.capMicroUsd ? ` of ${formatUsd(month.capMicroUsd)} cap` : ""}</Text>
            {month.capShare !== null ? <Progress percent={month.capShare} size="small" status={month.capShare >= 100 ? "exception" : month.capShare >= 80 ? "active" : "normal"} strokeColor={month.capShare >= 80 ? "#d97706" : undefined} /> : null}
            <Text type={month.projectedOverCap ? "danger" : "secondary"}>
              {month.projectedMicroUsd !== null ? `Projected month end: ${formatUsd(month.projectedMicroUsd)}${month.projectedOverCap ? " (over the cap: unanswered questions wait for a person once it is reached)" : ""}` : "Projection appears after the first day of the month."}
            </Text>
          </Space>
          <Space wrap>
            <Tag color={status.color}>AI recognition: {status.label}{summary.providerLabel ? ` · ${summary.providerLabel}` : ""}</Tag>
            <Tag>{summary.learnedWordings.toLocaleString()} learned wordings</Tag>
            <a href="#/application-guide">Review learned wordings →</a>
          </Space>
        </Space>
        {!summary.remembersWordings ? <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Learned wordings are not being saved" description="SUPABASE_SECRET_KEY is not set on the API, so every page pays for recognition again." /> : null}
      </Card>
      <OverviewKpiGrid columns={4}>
        <OverviewKpiCard tone="indigo" icon={<DollarOutlined />} value={formatUsd(totals.costMicroUsd)} label="AI cost in period" meta={`${totals.modelCalls.toLocaleString()} model calls · ${totals.draftedAnswers.toLocaleString()} answers drafted · ${(totals.inputTokens + totals.outputTokens).toLocaleString()} tokens`} />
        <OverviewKpiCard tone="green" icon={<SyncOutlined />} value={summary.reuseRate === null ? "—" : `${summary.reuseRate}%`} label="Answered from learned table" meta={`${totals.questionsFromTable.toLocaleString()} of ${totals.questionsAsked.toLocaleString()} unanswered questions, no AI cost`} />
        <OverviewKpiCard tone="purple" icon={<RobotOutlined />} value={totals.questionsSent.toLocaleString()} label="New wordings sent to AI" meta={`${totals.pages.toLocaleString()} pages had unanswered questions`} />
        <OverviewKpiCard tone="blue" icon={<ThunderboltOutlined />} value={formatUsd(summary.perApplicationMicroUsd)} label="Cost per autofilled application" meta={`${summary.applications.toLocaleString()} applications autofilled`} />
      </OverviewKpiGrid>
      {summary.days.length > 1 ? (
        <div style={{ marginTop: 16 }}>
          <OverviewChartCard title="Daily AI spend">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={summary.days.map((day) => ({ ...day, usd: day.costMicroUsd / 1_000_000 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(value) => formatOverviewDate(value).replace(/, \d{4}$/, "")} fontSize={12} />
                <YAxis tickFormatter={(value) => `$${value}`} fontSize={12} width={56} />
                <Tooltip formatter={(value, name, item) => [formatUsd(item.payload.costMicroUsd), `Spend · ${item.payload.questionsSent} new · ${item.payload.questionsFromTable} from table`]} labelFormatter={formatOverviewDate} />
                <Bar dataKey="usd" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </OverviewChartCard>
        </div>
      ) : null}
    </>
  );
}
