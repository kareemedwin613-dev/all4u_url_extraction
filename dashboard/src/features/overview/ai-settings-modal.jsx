import React, { useEffect, useMemo, useState } from "react";
import { Alert, App as AntApp, Button, Collapse, Form, InputNumber, List, Modal, Radio, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { ExperimentOutlined } from "@ant-design/icons";
import { getAutofillAiSettings, saveAutofillAiSettings, testAutofillAiModel } from "../../services/autofill-ai-usage-service.js";
import { formFromSettings, modelOptions, priceLabel, saveProblem, settingsLine, switchProvider, testSummary } from "./ai-settings.js";

const { Text } = Typography;
const when = (value) => (value ? new Date(value).toLocaleString() : "");

// Admin-only. Changes take effect on the next Autofill page; every save is kept in the change history.
export function AiSettingsModal({ client, apiBaseUrl, open, onClose, onSaved }) {
  const { message } = AntApp.useApp();
  const [data, setData] = useState(null), [form, setForm] = useState(null), [error, setError] = useState("");
  const [saving, setSaving] = useState(false), [testing, setTesting] = useState(false), [test, setTest] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setData(null); setForm(null); setError(""); setTest(null);
    getAutofillAiSettings(client, apiBaseUrl)
      .then((value) => { if (live) { setData(value); setForm(formFromSettings(value.settings)); } })
      .catch((value) => { if (live) setError(value?.message || "AI settings could not be loaded."); });
    return () => { live = false; };
  }, [open, client, apiBaseUrl]);

  const providers = data?.providers || [];
  const problem = form ? saveProblem(form, providers) : "";
  const options = useMemo(() => (form ? modelOptions(providers, form.provider) : []), [providers, form?.provider]);
  const chosen = (id) => options.find((option) => option.value === id)?.model;
  const update = (patch) => { setForm((current) => ({ ...current, ...patch })); setTest(null); };

  async function runTest() {
    setTesting(true); setTest(null);
    try { setTest(await testAutofillAiModel(client, apiBaseUrl, { provider: form.provider, model: form.recognitionModel })); }
    catch (value) { message.error(value?.message || "The model test failed."); }
    finally { setTesting(false); }
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await saveAutofillAiSettings(client, apiBaseUrl, { ...form, monthlyCapUsd: Number(form.monthlyCapUsd) });
      message.success("AI settings saved. They apply from the next Autofill page.");
      onSaved?.(saved);
      onClose();
    } catch (value) { message.error(value?.message || "AI settings could not be saved."); }
    finally { setSaving(false); }
  }

  const settings = data?.settings;
  const footer = (
    <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {settings?.source === "dashboard" ? `Last changed${settings.updatedByName ? ` by ${settings.updatedByName}` : ""} · ${when(settings.updatedAt)}` : settings ? "Using the server defaults; not saved here yet." : ""}
      </Text>
      <Space>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="primary" loading={saving} disabled={!form || Boolean(problem)} onClick={save}>Save</Button>
      </Space>
    </Space>
  );

  return (
    <Modal title="AI Autofill settings" open={open} onCancel={onClose} footer={footer} width={640} destroyOnClose>
      {error ? <Alert type="error" showIcon message={error} /> : !form ? <Spin style={{ display: "block", margin: "24px auto" }} /> : (
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="AI recognition">
            <Space><Switch checked={form.enabled} onChange={(enabled) => update({ enabled })} /><Text>{form.enabled ? "On" : "Off: unanswered questions are left for a person"}</Text></Space>
          </Form.Item>
          <Form.Item label="Provider" extra="API keys are set in Vercel and never shown here.">
            <Radio.Group value={form.provider} onChange={(event) => { setForm((current) => switchProvider(current, providers, event.target.value)); setTest(null); }}>
              <Space direction="vertical">
                {providers.map((provider) => (
                  <Radio key={provider.id} value={provider.id} disabled={!provider.keyConfigured && form.enabled}>
                    {provider.label}{" "}
                    {provider.keyConfigured ? <Tag color="green">key set</Tag> : <Tag color="orange">no key: add {provider.keyEnv} in Vercel</Tag>}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="Recognition model" extra={[priceLabel(chosen(form.recognitionModel)), chosen(form.recognitionModel)?.note].filter(Boolean).join(" · ")}>
            <Select value={form.recognitionModel} options={options} onChange={(recognitionModel) => update({ recognitionModel })} />
          </Form.Item>
          <Form.Item label="Drafting model" extra={`Used for AI-drafted answers (step 3). ${priceLabel(chosen(form.draftingModel))}`}>
            <Select value={form.draftingModel} options={options} onChange={(draftingModel) => update({ draftingModel })} />
          </Form.Item>
          <Form.Item label="Monthly cap" extra="Past the cap, unanswered questions wait for a person until next month (UTC).">
            <InputNumber prefix="$" min={0} max={10000} step={5} precision={2} value={form.monthlyCapUsd} onChange={(monthlyCapUsd) => update({ monthlyCapUsd })} style={{ width: 160 }} />
          </Form.Item>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space wrap>
              <Button icon={<ExperimentOutlined />} loading={testing} disabled={!providers.find((item) => item.id === form.provider)?.keyConfigured} onClick={runTest}>Test this model</Button>
              <Text type="secondary">Ten sample questions against {form.recognitionModel}; costs a fraction of a cent.</Text>
            </Space>
            {test ? (
              <Alert type={test.correct >= 9 ? "success" : test.correct >= 7 ? "warning" : "error"} showIcon message={testSummary(test)}
                description={test.results.some((item) => !item.ok) ? (
                  <List size="small" dataSource={test.results.filter((item) => !item.ok)} renderItem={(item) => (
                    <List.Item><Text style={{ fontSize: 12 }}>{item.question} · got <b>{item.got}</b>, expected <b>{item.expected}</b></Text></List.Item>
                  )} />
                ) : "Every sample answered as expected."} />
            ) : null}
            {problem ? <Alert type="warning" showIcon message={problem} /> : null}
            {!data.remembersWordings ? <Alert type="warning" showIcon message="SUPABASE_SECRET_KEY is not set on the API, so learned wordings are not saved." /> : null}
          </Space>
          {data.history?.length ? (
            <Collapse size="small" ghost style={{ marginTop: 12 }} items={[{ key: "history", label: `Recent changes (${data.history.length})`, children: (
              <List size="small" dataSource={data.history} renderItem={(item) => (
                <List.Item><Text style={{ fontSize: 12 }}>{when(item.changedAt)} · {item.changedByName || "Admin"} · {settingsLine(item.settings)}</Text></List.Item>
              )} />
            ) }]} />
          ) : null}
        </Form>
      )}
    </Modal>
  );
}
