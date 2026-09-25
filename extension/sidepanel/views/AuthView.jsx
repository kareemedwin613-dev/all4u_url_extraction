import React, { useState } from "react";
import { Alert, Button, Card, Divider, Form, Input, Space, Typography } from "antd";

const { Text, Title } = Typography;

export function AuthView({ onSignIn, onConnect, onCancelConnect, connecting }) {
  const [busy, setBusy] = useState(false);

  async function submit(values) {
    setBusy(true);
    try {
      await onSignIn(values.email, values.password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        Sign In
      </Title>
      {connecting ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Approve in the dashboard"
            description="A dashboard tab opened. Check that it shows this code, then click Approve. This panel signs in automatically."
          />
          <div style={{ fontFamily: "monospace", fontSize: 28, letterSpacing: 4, textAlign: "center" }} aria-label="Confirmation code">
            {connecting.code}
          </div>
          <Button block onClick={onCancelConnect}>Cancel</Button>
        </Space>
      ) : (
        <>
          <Text type="secondary">Already signed in to the dashboard? Connect without typing your password.</Text>
          <Button type="primary" block style={{ marginTop: 12 }} onClick={onConnect}>
            Connect with dashboard
          </Button>
        </>
      )}
      <Divider plain>or sign in with email and password</Divider>
      <Form layout="vertical" onFinish={submit} disabled={Boolean(connecting)}>
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: "Enter your email address." },
            { type: "email", message: "Enter a valid email address." },
          ]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          label="Password"
          name="password"
          rules={[{ required: true, message: "Enter your password." }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button htmlType="submit" loading={busy} block>
          Sign In
        </Button>
      </Form>
    </Card>
  );
}
