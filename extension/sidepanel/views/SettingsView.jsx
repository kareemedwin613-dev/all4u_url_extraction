import React, { useState } from "react";
import { Button, Card, Form, Input, InputNumber, Space, Typography } from "antd";
import {
  getSupabaseClient,
  validateSupabaseConfig,
} from "../../services/supabase-client.js";
import { safeError } from "../../shared/errors.js";
import { validateApiBaseUrl } from "../../services/api-client.js";

const { Text } = Typography;

export function SettingsView({
  config,
  backendBaseUrl,
  minimumScore,
  connectionStatus,
  onSave,
  onConnectionResult,
  onContinueToSignIn,
  onClearSession,
  clearBusy,
}) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(values) {
    const check = validateSupabaseConfig({
      projectUrl: values.projectUrl,
      publishableKey: values.publishableKey,
    });
    if (!check.valid) {
      form.setFields(
        Object.entries(check.errors).map(([name, error]) => ({ name, errors: [error] })),
      );
      return;
    }
    setSaving(true);
    try {
      const api = validateApiBaseUrl(values.backendBaseUrl);
      if (!api.valid) {
        form.setFields([{ name: "backendBaseUrl", errors: [api.error] }]);
        return;
      }
      await onSave(check.normalized, api.normalized, Number(values.minimumScore));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    const values = form.getFieldsValue();
    setTesting(true);
    try {
      const check = validateSupabaseConfig({
        projectUrl: values.projectUrl,
        publishableKey: values.publishableKey,
      });
      if (!check.valid) {
        form.setFields(
          Object.entries(check.errors).map(([name, error]) => ({ name, errors: [error] })),
        );
        return;
      }
      getSupabaseClient(check.normalized);
      const api = validateApiBaseUrl(values.backendBaseUrl);
      if (!api.valid) {
        form.setFields([{ name: "backendBaseUrl", errors: [api.error] }]);
        return;
      }
      const response = await fetch(`${api.normalized}/ready`);
      const readiness = await response.json().catch(() => ({}));
      if (!response.ok || readiness.dependencies?.supabase !== "ready") throw new Error("The backend could not verify Supabase readiness.");
      onConnectionResult({
        connection: "Backend and Supabase connected",
        message: "Connection was successful. The backend verified Supabase readiness.",
      });
    } catch (error) {
      const safe = safeError(error);
      onConnectionResult({
        connection: "Backend or Supabase connection failed",
        message: `Failed to verify the backend and Supabase connection. ${safe.details || safe.message}`,
        kind: "error",
      });
    } finally {
      setTesting(false);
    }
  }

  function continueToSignIn() {
    const values = form.getFieldsValue();
    const check = validateSupabaseConfig({
      projectUrl: values.projectUrl,
      publishableKey: values.publishableKey,
    });
    if (!check.valid) {
      onConnectionResult({
        message: "Save valid Supabase settings before signing in.",
        kind: "error",
      });
      return;
    }
    onContinueToSignIn();
  }

  return (
    <Card title="Settings">
      <Text type="secondary">{connectionStatus || "Not configured"}</Text>
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 12 }}
        initialValues={{
          projectUrl: config?.projectUrl || "",
          publishableKey: config?.publishableKey || "",
          backendBaseUrl: backendBaseUrl || "",
          minimumScore: minimumScore ?? 60,
        }}
        onFinish={submit}
      >
        <Form.Item
          label="Backend API base URL"
          name="backendBaseUrl"
          rules={[{ required: true, message: "Enter the backend API base URL." }]}
        >
          <Input placeholder="https://api.example.com" />
        </Form.Item>
        <Form.Item
          label="Supabase project URL"
          name="projectUrl"
          rules={[{ required: true, message: "Enter your Supabase project URL." }]}
        >
          <Input placeholder="https://project-ref.supabase.co" />
        </Form.Item>
        <Form.Item
          label="Supabase publishable/anon key"
          name="publishableKey"
          rules={[{ required: true, message: "Enter your Supabase publishable key." }]}
        >
          <Input.Password autoComplete="off" />
        </Form.Item>
        <Form.Item
          label="Minimum eligible match score"
          name="minimumScore"
          rules={[{ required: true, message: "Enter a minimum match score." }]}
        >
          <InputNumber min={0} max={100} style={{ width: "100%" }} />
        </Form.Item>
        <Space wrap>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save Settings
          </Button>
          <Button onClick={testConnection} loading={testing}>
            Test Supabase Connection
          </Button>
          <Button onClick={continueToSignIn}>Continue to Sign In</Button>
          <Button danger onClick={onClearSession} loading={clearBusy}>
            Clear Supabase Session
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
