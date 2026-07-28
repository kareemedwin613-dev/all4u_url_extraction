import React from "react";
import { Card, Typography } from "antd";
import { extensionAccessMessage } from "../../access/capabilities.js";

const { Paragraph, Title } = Typography;

export function AccessView({ access }) {
  const heading = !access
    ? "Account Access"
    : access.status === "INACTIVE"
      ? "Account Inactive"
      : !access.roles?.length
        ? "Pending Access"
        : "Extension Access";
  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        {heading}
      </Title>
      <Paragraph>{extensionAccessMessage(access)}</Paragraph>
      <Paragraph type="secondary">
        Use the web dashboard to view your profile or contact an administrator.
      </Paragraph>
    </Card>
  );
}
