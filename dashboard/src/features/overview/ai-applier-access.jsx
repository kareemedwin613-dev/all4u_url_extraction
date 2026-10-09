import React, { useEffect, useState } from "react";
import { Alert, App as AntApp, Card, Descriptions, Select, Space, Spin, Tag, Typography } from "antd";
import { ResizableTable as Table } from "../../shared/resizable-table.jsx";
import { formatDate } from "../../shared/formatters.js";
import { getAutofillAiAppliers, setAutofillAiAccess } from "../../services/autofill-ai-usage-service.js";
import { AI_LEVELS, applierAiRows, withLevel } from "./ai-access.js";
import { formatUsd } from "./ai-usage.js";

const { Text } = Typography;
const levelOptions = AI_LEVELS.map((level) => ({ value: level.value, label: level.label, title: level.description }));

// Loads everyone's access and usage for the period, and saves one person's level at a time.
function useApplierAccess(client, apiBaseUrl, dateRange, refresh) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState(null), [error, setError] = useState(""), [saving, setSaving] = useState("");
  useEffect(() => {
    let live = true;
    getAutofillAiAppliers(client, apiBaseUrl, dateRange || {})
      .then((value) => { if (live) { setRows(applierAiRows(value).rows); setError(""); } })
      .catch((value) => { if (live) setError(value?.message || "AI access could not be loaded."); });
    return () => { live = false; };
  }, [client, apiBaseUrl, dateRange?.from, dateRange?.to, refresh]);
  async function change(row, level) {
    const before = rows;
    setRows(withLevel(rows, row.userId, level));
    setSaving(row.userId);
    try {
      await setAutofillAiAccess(client, apiBaseUrl, row.userId, level);
      message.success(`${row.name}: AI ${AI_LEVELS.find((item) => item.value === level)?.label.toLowerCase()}. Applies from their next Autofill page.`);
    } catch (value) {
      setRows(before);
      message.error(value?.message || "AI access could not be changed.");
    } finally { setSaving(""); }
  }
  return { rows, error, saving, change };
}

// Overview: every Applier's AI access (editable) and their AI usage in the period.
export function AiApplierAccessCard({ client, apiBaseUrl, dateRange, dateLabel, refresh = 0, globallyOn = true }) {
  const { rows, error, saving, change } = useApplierAccess(client, apiBaseUrl, dateRange, refresh);
  const columns = [
    { title: "Applier", dataIndex: "name", width: 220, render: (name, row) => (
      <Space direction="vertical" size={0}>
        <a href={`#/appliers/${encodeURIComponent(row.userId)}`}>{name}</a>
        {!row.active ? <Tag>Inactive</Tag> : null}
      </Space>
    ) },
    { title: "AI access", dataIndex: "level", width: 210, render: (level, row) => (
      <Select size="small" value={level} options={levelOptions} style={{ width: 190 }} loading={saving === row.userId} disabled={Boolean(saving)}
        onChange={(value) => change(row, value)} aria-label={`AI access for ${row.name}`} />
    ) },
    { title: "Autofill runs", dataIndex: "autofillRuns", width: 110, align: "right", sorter: (a, b) => a.autofillRuns - b.autofillRuns },
    { title: "Runs with AI", dataIndex: "aiRuns", width: 110, align: "right", sorter: (a, b) => a.aiRuns - b.aiRuns },
    { title: "Matched by AI", dataIndex: "questionsMatched", width: 120, align: "right", render: (value, row) => <span title={`${row.questionsSent} new wordings sent to AI`}>{value}</span> },
    { title: "From learned table", dataIndex: "questionsFromTable", width: 140, align: "right" },
    { title: "Answers drafted", dataIndex: "draftedAnswers", width: 130, align: "right" },
    { title: "AI cost", dataIndex: "costMicroUsd", width: 100, align: "right", defaultSortOrder: "descend", sorter: (a, b) => a.costMicroUsd - b.costMicroUsd, render: formatUsd },
  ];
  return (
    <Card size="small" title="AI access by applier" extra={<Text type="secondary">{dateLabel}</Text>} style={{ marginTop: 16 }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Text type="secondary">Everyone starts at Off. Match lets AI link new question wordings to your standard answers; Match + draft also drafts answers to open-ended questions for review. Learned wordings answer for everyone at no AI cost.</Text>
        {!globallyOn ? <Alert type="info" showIcon message="AI is switched off for everyone in Configure. Access set here applies once it is switched on." /> : null}
        {error ? <Alert type="warning" showIcon message="AI access is not available yet" description={error} />
          : !rows ? <Spin style={{ display: "block", margin: "16px 0" }} />
          : <Table rowKey="userId" size="small" pagination={rows.length > 20 ? { pageSize: 20 } : false} columns={columns} dataSource={rows} scroll={{ x: 1100 }} />}
      </Space>
    </Card>
  );
}

// Applier page: this person's AI access (editable) and their AI usage in the period.
export function ApplierAiCard({ client, apiBaseUrl, userId, dateRange, dateLabel }) {
  const { rows, error, saving, change } = useApplierAccess(client, apiBaseUrl, dateRange, 0);
  const row = rows?.find((item) => item.userId === userId);
  return (
    <Card title="AI Autofill" extra={<Text type="secondary">{dateLabel}</Text>}>
      {error ? <Alert type="warning" showIcon message="AI access is not available yet" description={error} />
        : !rows ? <Spin />
        : !row ? <Text type="secondary">This person does not use Autofill.</Text>
        : (
          <Descriptions column={1} size="small">
            <Descriptions.Item label="AI access">
              <Select size="small" value={row.level} options={levelOptions} style={{ width: 210 }} loading={saving === row.userId} disabled={Boolean(saving)}
                onChange={(value) => change(row, value)} aria-label="AI access" />
            </Descriptions.Item>
            {row.grantedAt && row.level !== "OFF" ? <Descriptions.Item label="Given">{formatDate(row.grantedAt)}{row.grantedByName ? ` by ${row.grantedByName}` : ""}</Descriptions.Item> : null}
            <Descriptions.Item label="Runs with AI">{row.aiRuns.toLocaleString()} of {row.autofillRuns.toLocaleString()} Autofill runs</Descriptions.Item>
            <Descriptions.Item label="Questions">{row.questionsMatched.toLocaleString()} matched by AI · {row.questionsFromTable.toLocaleString()} from learned table</Descriptions.Item>
            <Descriptions.Item label="Answers drafted">{row.draftedAnswers.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="AI cost">{formatUsd(row.costMicroUsd)}</Descriptions.Item>
          </Descriptions>
        )}
    </Card>
  );
}
