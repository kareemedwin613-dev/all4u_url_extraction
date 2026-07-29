import React from "react";
import { Alert, Button, Card, Checkbox, Flex, Space, Tag, Typography } from "antd";

const { Text } = Typography;
const LABELS = {
  "candidate.firstName": "First name", "candidate.middleName": "Middle name", "candidate.lastName": "Last name",
  "candidate.fullName": "Full name", "candidate.email": "Email", "candidate.phone": "Phone",
  "candidate.addressLine1": "Address line 1", "candidate.addressLine2": "Address line 2", "candidate.city": "City",
  "candidate.state": "State / region", "candidate.postalCode": "Postal code", "candidate.country": "Country",
  "candidate.linkedInUrl": "LinkedIn", "candidate.githubUrl": "GitHub", "candidate.portfolioUrl": "Portfolio",
  "candidate.summary": "Summary",
};
const RESULT_MESSAGES = {
  FIELD_VERIFICATION_FAILED: "The page changed or reformatted this value. Review it manually.",
  FIELD_NO_LONGER_AVAILABLE: "This field changed after the preview. Start Autofill again.",
  VALUE_UNAVAILABLE: "No verified Resume value is available.",
  SELECT_OPTION_NOT_FOUND: "The page does not offer a matching option.",
  FIELD_FILL_FAILED: "The page prevented this field from being filled.",
};

export function AutofillPreview({ active, busy, onSelectionChange, onFill }) {
  const fields = active.autofillFields || [], selected = new Set(active.selectedAutofillFieldIds || []), results = active.autofillResults || [];
  const resultById = new Map(results.map((result) => [result.fieldId, result]));
  return (
    <Card size="small" title="Autofill Preview" style={{ marginBottom: 12 }}>
      <Alert type="info" showIcon message="Review before filling" description="Only checked fields will be filled. The extension verifies each result and never submits the application." style={{ marginBottom: 10 }} />
      {!fields.length ? <Text type="secondary">No supported personal or contact fields were found on this page.</Text> : (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          {fields.map((field) => {
            const result = resultById.get(field.fieldId), value = active.autofillContext.values[field.key] || "";
            return <Flex key={field.fieldId} gap={8} align="start">
              <Checkbox checked={selected.has(field.fieldId)} disabled={result?.status === "VERIFIED"} onChange={(event) => onSelectionChange(field.fieldId, event.target.checked)} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Flex justify="space-between" gap={8}><Text strong>{LABELS[field.key] || field.label}</Text><Tag color={field.readiness === "READY" ? "green" : "gold"}>{field.confidence}%</Tag></Flex>
                <Text ellipsis={{ tooltip: value }} style={{ display: "block" }}>{value}</Text>
                {result && <Text type={result.status === "VERIFIED" ? "success" : "danger"}>{result.status === "VERIFIED" ? "Filled and verified" : RESULT_MESSAGES[result.code] || result.code.replaceAll("_", " ")}</Text>}
              </div>
            </Flex>;
          })}
          <Button type="primary" loading={busy} disabled={!selected.size || fields.every((field) => resultById.get(field.fieldId)?.status === "VERIFIED")} onClick={onFill}>Fill selected fields</Button>
        </Space>
      )}
    </Card>
  );
}
