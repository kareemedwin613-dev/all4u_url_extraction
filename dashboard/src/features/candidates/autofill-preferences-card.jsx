import React, { useEffect, useState } from "react";
import { Alert, Button, Card, Divider, Flex, Form, Select, Switch, Typography } from "antd";

const GENDER_OPTIONS = [
  { value: "", label: "Not recorded" },
  { value: "MALE", label: "Male (He/Him)" },
  { value: "FEMALE", label: "Female (She/Her)" },
  { value: "NON_BINARY", label: "Non-binary (They/Them)" },
];

export function AutofillPreferencesCard({ value, busy, onSave, gender = null, resumeType = "ORIGINAL", onSaveGender }) {
  const [form] = Form.useForm();
  const [genderDraft, setGenderDraft] = useState(gender || "");
  useEffect(() => { if (value) form.setFieldsValue(value); }, [value, form]);
  useEffect(() => { setGenderDraft(gender || ""); }, [gender]);
  if (!value) return <Card title="Autofill Permissions" loading />;
  const tailored = resumeType === "TAILORED";
  return <Card title="Autofill Permissions">
    <Alert type="info" showIcon message="Resume-level consent" description="These controls are checked by the backend when Autofill starts and again before a retry. Archiving the Resume disables Autofill and attachment immediately." />
    <Form form={form} layout="vertical" onFinish={onSave} style={{marginTop:12}}>
      <Form.Item name="allowAttachment" label="Allow this Resume file to be attached" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="allowProfileFields" label="Allow reviewed personal, employment, and education fields" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="allowReviewedAnswers" label="Allow reviewed Answer Library responses" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="requireReviewEveryField" label="Require a preview click before filling any field" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="prohibitSensitiveQuestions" label="Never fill voluntary demographic, gender, pronoun, or veteran questions (including Application Guide answers)" valuePropName="checked"><Switch /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>Save Autofill Permissions</Button>
    </Form>
    {onSaveGender ? <>
      <Divider />
      <Typography.Text strong>Gender</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {tailored ? "Tailored Resumes use the gender recorded on their original Resume." : "Used for gender and pronoun questions when sensitive questions are allowed above."}
      </Typography.Paragraph>
      <Flex gap={8}>
        <Select aria-label="Gender" style={{ minWidth: 240 }} value={genderDraft} options={GENDER_OPTIONS} disabled={tailored || busy} onChange={setGenderDraft} />
        <Button disabled={tailored || genderDraft === (gender || "")} loading={busy} onClick={() => onSaveGender(genderDraft || null)}>Save Gender</Button>
      </Flex>
    </> : null}
  </Card>;
}
