import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntApp, Button, Collapse, Empty, Input, Modal, Select, Spin, Tag, Typography } from "antd";
import { ROLE_CODES } from "../../access/role-codes.js";
import { PageHeading } from "../../components/ui.jsx";
import { formatDate } from "../../shared/formatters.js";
import {
  GUIDE_ANSWER_TYPES,
  GUIDE_CATEGORIES,
  guideEntryIsUpdated,
  guideEntryMatches,
  guideLabel,
} from "./application-guide.js";
import { deleteApplicationGuide, listApplicationGuide, saveApplicationGuide } from "./application-guide-service.js";

const { Paragraph, Text, Title } = Typography;

const EMPTY_ENTRY = {
  id: "",
  question: "",
  meaning: "",
  howToAnswer: "",
  exampleAnswer: "",
  answerType: "GENERAL_GUIDANCE",
  category: "PERSONAL_DETAILS",
};

function reviewLine(entry) {
  const who = entry.status === "DRAFT"
    ? "Draft"
    : (entry.approvedByName || "Published guidance");
  return `${who} · ${formatDate(entry.updatedAt || entry.publishedAt)} · v${entry.version || 1}`;
}

function EntryBody({ entry }) {
  const personal = entry.answerType === "CANDIDATE_INFORMATION" || entry.answerType === "CANDIDATE_DECISION";
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
          <Title level={5}>Example only</Title>
          <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{entry.exampleAnswer}</Paragraph>
        </div>
      ) : null}
      {personal ? (
        <Alert
          className="application-guide-personal"
          type="info"
          showIcon
          message="Use the candidate's confirmed information. Do not reuse one Yes or No for every profile."
        />
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
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState("");
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);

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
    () => entries.filter((entry) => guideEntryMatches(entry, { search, category })),
    [entries, search, category],
  );

  useEffect(() => {
    if (!visible.some((entry) => entry.id === openId)) setOpenId(visible[0]?.id || "");
  }, [visible, openId]);

  function openNew() {
    setEditor({ ...EMPTY_ENTRY });
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
      answerType: entry.answerType,
      category: entry.category,
    });
  }

  async function save(status) {
    if (!editor) return;
    setSaving(true);
    try {
      const body = { ...editor, status, exampleAnswer: editor.exampleAnswer || "" };
      if (!body.id) delete body.id;
      await saveApplicationGuide(client, apiBaseUrl, body);
      setEditor(null);
      message.success(status === "PUBLISHED" ? "Published for appliers." : "Draft saved. Appliers cannot see it yet.");
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
      <Input
        className="application-guide-search"
        allowClear
        size="large"
        aria-label="Search questions"
        placeholder='Search a question, e.g. "address line 2" or "remote"'
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="application-guide-categories" role="group" aria-label="Question categories">
        <Button type={category === "" ? "primary" : "default"} onClick={() => setCategory("")}>All questions</Button>
        {GUIDE_CATEGORIES.map((item) => (
          <Button key={item.value} type={category === item.value ? "primary" : "default"} onClick={() => setCategory(item.value)}>
            {item.label}
          </Button>
        ))}
      </div>
      <Alert
        className="application-guide-note"
        type="info"
        showIcon
        message="Use the candidate's confirmed information. Questions marked Candidate decision need their own answer."
      />
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
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
          items={visible.map((entry) => ({
            key: entry.id,
            className: "application-guide-entry",
            label: (
              <span>
                <span className="application-guide-question">
                  <Text strong>{entry.question}</Text>
                  {entry.status === "DRAFT" ? <Tag>Draft</Tag> : null}
                  {guideEntryIsUpdated(entry) ? <Tag color="blue">Updated</Tag> : null}
                </span>
                <Text type="secondary">
                  {guideLabel(GUIDE_CATEGORIES, entry.category)}
                  {" · "}
                  {guideLabel(GUIDE_ANSWER_TYPES, entry.answerType)}
                </Text>
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
              Category
              <Select
                style={{ width: "100%" }}
                value={editor.category}
                options={GUIDE_CATEGORIES}
                onChange={(value) => setEditor({ ...editor, category: value })}
              />
            </label>
            <label>
              Answer type
              <Select
                style={{ width: "100%" }}
                value={editor.answerType}
                options={GUIDE_ANSWER_TYPES}
                onChange={(value) => setEditor({ ...editor, answerType: value })}
              />
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
              Example
              <Input.TextArea value={editor.exampleAnswer} maxLength={1000} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => setEditor({ ...editor, exampleAnswer: event.target.value })} />
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
