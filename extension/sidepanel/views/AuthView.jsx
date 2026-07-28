import React, { useState } from "react";
import { Button, Card, Form, Input, Typography } from "antd";

const { Text, Title } = Typography;

export function AuthView({ onSignIn }) {
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
      <Text type="secondary">Use an account created in the Supabase Dashboard.</Text>
      <Form layout="vertical" style={{ marginTop: 12 }} onFinish={submit}>
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
        <Button type="primary" htmlType="submit" loading={busy} block>
          Sign In
        </Button>
      </Form>
    </Card>
  );
}
