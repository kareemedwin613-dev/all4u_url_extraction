import React, { useEffect } from "react";
import { Alert, Button, Card, Form, Switch } from "antd";

export function AutofillPreferencesCard({ value, busy, onSave }) {
  const [form] = Form.useForm();
  useEffect(() => { if (value) form.setFieldsValue(value); }, [value, form]);
  if (!value) return <Card title="Autofill permissions" loading />;
  return <Card title="Autofill permissions">
    <Alert type="info" showIcon message="Resume-level consent" description="These controls are checked by the backend when Autofill starts and again before a retry. Archiving the Resume disables Autofill and attachment immediately." />
    <Form form={form} layout="vertical" onFinish={onSave} style={{marginTop:12}}>
      <Form.Item name="allowAttachment" label="Allow this Resume file to be attached" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="allowProfileFields" label="Allow reviewed personal, employment, and education fields" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="allowReviewedAnswers" label="Allow reviewed Answer Library responses" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="requireReviewEveryField" label="Require a preview click before filling any field" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="prohibitSensitiveQuestions" label="Never fill voluntary demographic or veteran questions" valuePropName="checked"><Switch /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>Save Autofill Permissions</Button>
    </Form>
  </Card>;
}
