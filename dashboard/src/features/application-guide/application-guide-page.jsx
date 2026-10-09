import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntApp, Button, Card, Checkbox, Collapse, Empty, Input, List, Modal, Segmented, Select, Spin, Tag, Typography } from "antd";
import { ROLE_CODES } from "../../access/role-codes.js";
import { PageHeading } from "../../components/ui.jsx";
import { formatDate } from "../../shared/formatters.js";
import { GUIDE_AUTOFILL_MODES, GUIDE_AUTOFILL_SOURCES, LEARNED_KINDS, correctionBody, correctionOptions, correctionValue, filterLearnedWordings, guideAutofillLabel, guideEntryFromLearned, guideEntryIsUpdated, guideEntryMatches, learnedTargetLabel, sortGuideEntries } from "./application-guide.js";
import { correctLearnedAutofillWording, deleteApplicationGuide, listApplicationGuide, listLearnedAutofillWordings, removeLearnedAutofillWording, saveApplicationGuide } from "./application-guide-service.js";

const { Paragraph, Text, Title } = Typography;

const EMPTY_ENTRY = {
  id: "",
  question: "",
  meaning: "",
  howToAnswer: "",
  exampleAnswer: "",
  autofillMode: "NONE",
  autofillValue: "",
  autofillSource: undefined,
  autofillPatterns: [],
  autofillSensitive: false,
};

function autofillBody(editor) {
  return {
    mode: editor.autofillMode || "NONE",
    value: editor.autofillValue || "",
    source: editor.autofillMode === "DERIVED" ? editor.autofillSource : undefined,
    patterns: (editor.autofillPatterns || []).map((item) => String(item).trim()).filter(Boolean).slice(0, 20),
    sensitive: Boolean(editor.autofillSensitive),
  };
}

function learnedTarget(item) {
  const key = String(item.targetKey);
  const color = key === "none" ? LEARNED_KINDS[item.answerKind]?.color : key.startsWith("answer.") ? "blue" : key.startsWith("field.") ? "cyan" : "purple";
  return <Tag color={color}>{learnedTargetLabel(item)}</Tag>;
}

// What AI recognition learned. Each wording is reused for every Applier; removing one makes the AI decide again.
// Questions every candidate answers the same way can get a standard answer here, which Autofill then fills.
function LearnedWordings({ data, onRemove, onAddAnswer, onCorrect }) {
  const [filter, setFilter] = useState("ALL");
  const items = data?.items || [], month = data?.month || {}, needs = Number(data?.needsStandardAnswer) || 0;
  const shown = filterLearnedWordings(items, filter);
  return (
    <Collapse size="small" style={{ marginBottom: 16 }} items={[{
      key: "learned",
      label: <span>Learned by AI ({data?.total ?? items.length}){needs ? <Tag color="orange" style={{ marginLeft: 8 }}>{needs} need a standard answer</Tag> : null} · this month: {month.questions || 0} new question{month.questions === 1 ? "" : "s"}, ${((month.costMicroUsd || 0) / 1_000_000).toFixed(2)}</span>,
      children: items.length ? (
        <>
          <Segmented size="small" style={{ marginBottom: 8 }} value={filter} onChange={setFilter} options={[
            { value: "ALL", label: "All" }, { value: "NEEDS_ANSWER", label: `Needs a standard answer (${needs})` },
            { value: "MATCHED", label: "Matched" }, { value: "NO_ANSWER", label: "No standard answer" },
          ]} />
          <List
          size="small"
          dataSource={shown}
          locale={{ emptyText: "Nothing here." }}
          renderItem={(item) => (
            <List.Item actions={[
              item.targetKey === "none" ? <Button key="add" type="link" onClick={() => onAddAnswer(item)} style={item.answerKind === "SAME_FOR_EVERYONE" ? { fontWeight: 600 } : undefined}>Add standard answer</Button> : null,
              <Button key="correct" type="link" onClick={() => onCorrect(item)}>Correct</Button>,
              <Button key="remove" type="link" danger onClick={() => onRemove(item)}>Remove</Button>,
            ].filter(Boolean)}>
              <List.Item.Meta
                title={item.question}
                description={<span>{learnedTarget(item)}{item.correctedAt ? <Tag color="green">Corrected{item.correctedByName ? ` by ${item.correctedByName}` : ""}</Tag> : null}<Text type="secondary">{item.correctedAt ? `corrected ${formatDate(item.correctedAt)}` : `${item.confidence}% sure · learned ${formatDate(item.createdAt)}`} · used on {item.daysUsed} day{item.daysUsed === 1 ? "" : "s"}</Text></span>}
              />
            </List.Item>
          )}
          />
        </>
      ) : <Empty description="Nothing learned yet. Wordings appear here after Autofill meets questions its rules cannot answer." />,
    }]} />
  );
}

function reviewLine(entry) {
  const who = entry.status === "DRAFT"
    ? "Draft"
    : (entry.approvedByName || "Published guidance");
  return `${who} · ${formatDate(entry.updatedAt || entry.publishedAt)} · v${entry.version || 1}`;
}

function EntryBody({ entry }) {
  return (
    <div>
      <div className="application-guide-section">
        <Title level={5}>What it means</Title>
        <Paragraph style={{ marginBottom: 0 }}>{entry.meaning}</Paragraph>
      </div>
      <div className="application-guide-section">
        <Title level={5}>How to answer</Title>
        <Paragraph style={{ marginBottom: 0 }}>{entry.howToAnswer}</Paragraph>
      </div>
      {entry.exampleAnswer ? (
        <div className="application-guide-section">
          <Title level={5}>Example</Title>
          <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{entry.exampleAnswer}</Paragraph>
        </div>
      ) : null}
      <Text type="secondary" className="application-guide-review">{reviewLine(entry)}</Text>
    </div>
  );
}

export function ApplicationGuidePage({ client, apiBaseUrl, access }) {
  const isAdmin = (access?.roles || []).includes(ROLE_CODES.ADMIN);
  const { message, modal } = AntApp.useApp();
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("asc");
  const [openId, setOpenId] = useState("");
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [learned, setLearned] = useState(null);
  const [correcting, setCorrecting] = useState(null);

  const loadLearned = useCallback(() => {
    if (!isAdmin) return Promise.resolve();
    return listLearnedAutofillWordings(client, apiBaseUrl).then(setLearned).catch(() => setLearned(null));
  }, [client, apiBaseUrl, isAdmin]);

  useEffect(() => { void loadLearned(); }, [loadLearned]);

  function removeLearned(item) {
    modal.confirm({
      title: "Remove this learned wording?",
      content: "Autofill stops using it right away. The next time the question appears, the AI decides again.",
      okText: "Remove", okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeLearnedAutofillWording(client, apiBaseUrl, item.id);
          setLearned((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, (current.total || 1) - 1) } : current);
          message.success("Learned wording removed.");
        } catch (removeError) { message.error(removeError?.message || "The learned wording could not be removed."); }
      },
    });
  }

  async function saveCorrection() {
    const { item, value } = correcting || {};
    if (!item || !value) return;
    try {
      const body = correctionBody(value);
      await correctLearnedAutofillWording(client, apiBaseUrl, item.id, body);
      const targetQuestion = body.targetKey.startsWith("guide.") ? entries.find((entry) => `guide.${entry.id}` === body.targetKey)?.question || null : null;
      setLearned((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id
        ? { ...row, targetKey: body.targetKey, answerKind: body.answerKind || null, targetQuestion, confidence: 100, correctedAt: new Date().toISOString(), correctedByName: null } : row) } : current);
      setCorrecting(null);
      message.success("Corrected. Autofill uses it from the next page, for every applier.");
    } catch (correctError) { message.error(correctError?.message || "The learned wording could not be corrected."); }
  }

  const load = useCallback(() => {
    return listApplicationGuide(client, apiBaseUrl)
      .then((rows) => {
        setEntries(Array.isArray(rows) ? rows : []);
        setError("");
      })
      .catch((reason) => setError(reason?.message || "The Application Guide could not be loaded."));
  }, [client, apiBaseUrl]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (typeof client?.channel !== "function") return undefined;
    let refreshing = false;
    const run = async () => {
      if (document.visibilityState === "hidden" || refreshing) return;
      refreshing = true;
      try { await load(); } finally { refreshing = false; }
    };
    const channel = client.channel(`application-guide:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "application_guide_entries" }, () => { void run(); })
      .subscribe();
    const timer = setInterval(run, 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void client.removeChannel(channel).catch(() => {});
    };
  }, [client, load]);

  const visible = useMemo(
    () => sortGuideEntries(entries.filter((entry) => guideEntryMatches(entry, { search })), sort),
    [entries, search, sort],
  );

  useEffect(() => {
    if (!visible.some((entry) => entry.id === openId)) setOpenId(visible[0]?.id || "");
  }, [visible, openId]);

  function openNew(question = "") {
    setEditor({ ...EMPTY_ENTRY, question: typeof question === "string" ? question : "" });
  }

  function openEdit(entry, event) {
    event?.preventDefault();
    event?.stopPropagation();
    setEditor({
      id: entry.id,
      question: entry.question,
      meaning: entry.meaning,
      howToAnswer: entry.howToAnswer,
      exampleAnswer: entry.exampleAnswer || "",
      autofillMode: entry.autofillMode || "NONE",
      autofillValue: entry.autofillValue || "",
      autofillSource: entry.autofillSource || undefined,
      autofillPatterns: entry.autofillPatterns || [],
      autofillSensitive: Boolean(entry.autofillSensitive),
    });
  }

  async function save(status) {
    if (!editor) return;
    setSaving(true);
    try {
      const { autofillMode, autofillValue, autofillSource, autofillPatterns, autofillSensitive, fromLearnedId, ...content } = editor;
      const body = { ...content, status, exampleAnswer: editor.exampleAnswer || "", autofill: autofillBody(editor) };
      if (!body.id) delete body.id;
      await saveApplicationGuide(client, apiBaseUrl, body);
      setEditor(null);
      message.success(status === "PUBLISHED" ? "Published for appliers." : "Draft saved. Appliers cannot see it yet.");
      // Once published, the entry answers this wording itself, so the learned "no standard answer" row goes.
      if (status === "PUBLISHED" && fromLearnedId) {
        await removeLearnedAutofillWording(client, apiBaseUrl, fromLearnedId).catch(() => {});
        void loadLearned();
      }
      await load();
    } catch (reason) {
      message.error(reason?.message || "The guide entry could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function remove(entry) {
    modal.confirm({
      title: "Remove this question?",
      content: "Appliers will no longer see it.",
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteApplicationGuide(client, apiBaseUrl, entry.id);
        message.success("Question removed.");
        setEditor(null);
        await load();
      },
    });
  }

  return (
    <div className="page application-guide">
      <PageHeading
        eyebrow="Team knowledge"
        title="Application Guide"
        extra={isAdmin ? <Button type="primary" onClick={openNew}>Add question</Button> : null}
      />
      <Text type="secondary" className="application-guide-lead">Find the meaning, check the guidance, and answer with confidence.</Text>
      <div className="application-guide-toolbar">
        <Input
          className="application-guide-search"
          allowClear
          size="large"
          aria-label="Search questions"
          placeholder='Search a question, e.g. "address line 2" or "remote"'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          className="application-guide-sort"
          size="large"
          aria-label="Sort questions"
          value={sort}
          onChange={setSort}
          options={[
            { value: "asc", label: "A to Z" },
            { value: "desc", label: "Z to A" },
          ]}
        />
      </div>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      {isAdmin && learned ? <LearnedWordings data={learned} onRemove={removeLearned} onAddAnswer={(item) => setEditor(guideEntryFromLearned(item, EMPTY_ENTRY))} onCorrect={(item) => setCorrecting({ item, value: correctionValue(item) })} /> : null}
      <Modal open={Boolean(correcting)} title="Correct what this question asks for" okText="Save correction" okButtonProps={{ disabled: !correcting?.value }}
        onOk={saveCorrection} onCancel={() => setCorrecting(null)} destroyOnHidden>
        <Paragraph strong>{correcting?.item?.question}</Paragraph>
        <Select showSearch optionFilterProp="label" style={{ width: "100%" }} placeholder="What should Autofill do with it?" value={correcting?.value}
          options={correctionOptions(entries)} onChange={(value) => setCorrecting((current) => ({ ...current, value }))} />
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          A contact field fills the box from the Resume (LinkedIn URL, phone, …). A standard answer fills the guide's answer. The AI never changes a corrected wording; Remove lets it decide again.
        </Paragraph>
      </Modal>
      {loading ? <Spin /> : null}
      {!loading && !visible.length ? (
        <Empty description={entries.length ? "No questions match this search." : "No published questions yet."} />
      ) : null}
      {!loading && visible.length ? (
        <Collapse
          accordion
          className="application-guide-list"
          activeKey={openId || undefined}
          onChange={(key) => setOpenId(Array.isArray(key) ? key[0] || "" : key || "")}
          items={visible.map((entry, index) => ({
            key: entry.id,
            className: "application-guide-entry",
            label: (
              <span>
                <span className="application-guide-question">
                  <span className="application-guide-number">{index + 1}</span>
                  <Text strong>{entry.question}</Text>
                  {entry.status === "DRAFT" ? <Tag>Draft</Tag> : null}
                  {guideEntryIsUpdated(entry) ? <Tag color="blue">Updated</Tag> : null}
                  {guideAutofillLabel(entry) ? <Tag color={entry.autofillMode === "NEVER" ? "orange" : "green"}>{guideAutofillLabel(entry)}</Tag> : null}
                </span>
              </span>
            ),
            extra: isAdmin ? (
              <Button type="link" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => openEdit(entry, event)}>
                Edit
              </Button>
            ) : null,
            children: <EntryBody entry={entry} />,
          }))}
        />
      ) : null}
      <Modal
        title={editor?.id ? "Edit question" : "Add question"}
        open={Boolean(editor)}
        onCancel={() => !saving && setEditor(null)}
        footer={editor ? [
          editor.id ? <Button key="remove" danger disabled={saving} onClick={() => remove(editor)}>Remove</Button> : <span key="spacer" />,
          <Button key="cancel" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button>,
          <Button key="draft" disabled={saving} onClick={() => save("DRAFT")}>Save draft</Button>,
          <Button key="publish" type="primary" loading={saving} onClick={() => save("PUBLISHED")}>Publish</Button>,
        ] : null}
        destroyOnHidden
        width={720}
      >
        {editor ? (
          <div className="application-guide-form">
            <label>
              Question
              <Input value={editor.question} maxLength={300} onChange={(event) => setEditor({ ...editor, question: event.target.value })} />
            </label>
            <label>
              What it means
              <Input.TextArea value={editor.meaning} maxLength={2000} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => setEditor({ ...editor, meaning: event.target.value })} />
            </label>
            <label>
              How to answer
              <Input.TextArea value={editor.howToAnswer} maxLength={4000} autoSize={{ minRows: 4, maxRows: 10 }} onChange={(event) => setEditor({ ...editor, howToAnswer: event.target.value })} />
            </label>
            <label>
              Example (optional)
              <Input.TextArea value={editor.exampleAnswer} maxLength={1000} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => setEditor({ ...editor, exampleAnswer: event.target.value })} />
            </label>
            <fieldset className="application-guide-autofill">
              <legend>Autofill</legend>
              <label>
                How Autofill treats this question
                <Select value={editor.autofillMode} options={GUIDE_AUTOFILL_MODES} onChange={(value) => setEditor({ ...editor, autofillMode: value })} />
              </label>
              {editor.autofillMode === "DERIVED" ? (
                <label>
                  Take the answer from
                  <Select value={editor.autofillSource} options={GUIDE_AUTOFILL_SOURCES} placeholder="Choose a source" onChange={(value) => setEditor({ ...editor, autofillSource: value })} />
                </label>
              ) : null}
              {editor.autofillMode === "FIXED" || editor.autofillMode === "DERIVED" ? (
                <label>
                  {editor.autofillMode === "FIXED" ? "Answer to fill" : "Fallback or default answer (optional)"}
                  <Input value={editor.autofillValue} maxLength={500} placeholder={editor.autofillMode === "FIXED" ? "e.g. No" : "e.g. 150000"} onChange={(event) => setEditor({ ...editor, autofillValue: event.target.value })} />
                </label>
              ) : null}
              {editor.autofillMode !== "NONE" ? (
                <>
                  <label>
                    Other wordings of this question (optional)
                    <Select mode="tags" value={editor.autofillPatterns} maxCount={20} placeholder="e.g. visa sponsorship. Use [Company] for the employer name." onChange={(value) => setEditor({ ...editor, autofillPatterns: value })} />
                  </label>
                  <Checkbox checked={editor.autofillSensitive} onChange={(event) => setEditor({ ...editor, autofillSensitive: event.target.checked })}>
                    Voluntary self-identification (skipped when a Resume prohibits sensitive questions)
                  </Checkbox>
                </>
              ) : null}
            </fieldset>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
