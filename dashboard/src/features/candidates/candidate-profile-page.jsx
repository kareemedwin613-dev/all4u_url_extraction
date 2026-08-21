import React, { useEffect, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  Row,
  Tag,
  Typography,
} from "antd";
import {
  getResumeAutofillPreferences,
  importCandidateEmployment,
  updateCandidateProfile,
  updateResumeAutofillPreferences,
} from "./candidate-profile-service.js";
import { StructuredResumeEditor } from "./structured-resume-editor.jsx";
import { AutofillPreferencesCard } from "./autofill-preferences-card.jsx";
import { notifyFromApp } from "../../shared/notifications.js";

const { Title, Text } = Typography;

export function CandidateProfilePage({ client, apiBaseUrl, id }) {
  const { notification } = AntApp.useApp(),
    [profile, setProfile] = useState(),
    [preferences, setPreferences] = useState(),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  const notify = (type, message, description) =>
    notifyFromApp(notification, type, message, description);
  const load = () => {
    setLoadError("");
    setProfile(undefined);
    Promise.all([
      importCandidateEmployment(client, apiBaseUrl, id),
      getResumeAutofillPreferences(client, apiBaseUrl, id),
    ])
      .then(([nextProfile, nextPreferences]) => {
        setProfile(nextProfile);
        setPreferences(nextPreferences.preferences);
      })
      .catch((x) => setLoadError(x.message));
  };
  useEffect(load, [client, apiBaseUrl, id]);
  useEffect(() => {
    if (!profile) return;
    const address = profile.addresses?.find((x) => x.isPrimary) || {},
      links = Object.fromEntries(
        (profile.links || []).map((x) => [x.linkType, x.url]),
      );
    form.setFieldsValue({
      fullName: profile.fullName,
      firstName: profile.firstName,
      middleName: profile.middleName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      stateRegion: address.stateRegion,
      postalCode: address.postalCode,
      country: address.country,
      linkedInUrl: links.LINKEDIN,
      githubUrl: links.GITHUB,
      portfolioUrl: links.PORTFOLIO,
      verified: profile.reviewStatus === "VERIFIED",
    });
  }, [profile, form]);
  async function saveProfile(values) {
    setBusy(true);
    try {
      const links = [
          ["LINKEDIN", values.linkedInUrl],
          ["GITHUB", values.githubUrl],
          ["PORTFOLIO", values.portfolioUrl],
        ]
          .filter(([, url]) => url)
          .map(([linkType, url]) => ({ linkType, url })),
        primaryAddress = {
          addressLine1: values.addressLine1 || "",
          addressLine2: values.addressLine2 || "",
          city: values.city || "",
          stateRegion: values.stateRegion || "",
          postalCode: values.postalCode || "",
          country: values.country || "",
        };
      const next = await updateCandidateProfile(client, apiBaseUrl, id, {
        fullName: values.fullName,
        firstName: values.firstName || "",
        middleName: values.middleName || "",
        lastName: values.lastName || "",
        email: values.email || undefined,
        phone: values.phone || "",
        reviewStatus: values.verified ? "VERIFIED" : "NEEDS_REVIEW",
        primaryAddress,
        links,
      });
      setProfile(next);
      notify("success", "Personal Resume details saved.");
    } catch (x) {
      notify("error", "Personal details could not be saved", x.message);
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences(values) {
    setBusy(true);
    try {
      const next = await updateResumeAutofillPreferences(
        client,
        apiBaseUrl,
        id,
        values,
      );
      setPreferences(next.preferences);
      notify("success", "Autofill permissions saved.");
    } catch (x) {
      notify("error", "Autofill permissions could not be saved", x.message);
    } finally {
      setBusy(false);
    }
  }
  if (profile === undefined && !loadError)
    return (
      <div className="page">
        <Card loading />
      </div>
    );
  if (loadError && !profile)
    return (
      <div className="page">
        <Alert
          type="error"
          showIcon
          message="Resume metadata could not be loaded"
          description={loadError}
        />
      </div>
    );
  return (
    <div className="page">
      <a className="back-link" href={`#/resumes/${profile.resumeId}`}>
        ← Back to Resume
      </a>
      <Flex justify="space-between" align="center" wrap>
        <div>
          <Text type="secondary" className="eyebrow">
            Resume editor
          </Text>
          <Title level={1}>{profile.fullName}</Title>
        </div>
        <Tag color={profile.reviewStatus === "VERIFIED" ? "green" : "gold"}>
          {profile.reviewStatus.replace("_", " ")}
        </Tag>
      </Flex>
      <Alert
        type="info"
        showIcon
        message="Edit the canonical Resume"
        description="Personal details and structured sections are stored on this Resume and reused by autofill. Structured sections are saved together so ordering and deletions remain consistent."
      />
      <Card title="Personal, contact, address, and links">
        <Form form={form} layout="vertical" onFinish={saveProfile}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="fullName"
                label="Full name"
                rules={[{ required: true, max: 200 }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email" rules={[{ type: "email" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="firstName" label="First name">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="middleName" label="Middle name">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="lastName" label="Last name">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="Phone">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="addressLine1" label="Address line 1">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="addressLine2" label="Address line 2">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="city" label="City">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="stateRegion" label="State / region">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="postalCode" label="Postal code">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="country" label="Country">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="linkedInUrl"
                label="LinkedIn URL"
                rules={[{ type: "url" }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="githubUrl"
                label="GitHub URL"
                rules={[{ type: "url" }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="portfolioUrl"
                label="Portfolio URL"
                rules={[{ type: "url" }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="verified" valuePropName="checked">
            <Checkbox>
              I reviewed these values and confirm they are accurate for this
              Resume.
            </Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            Save Personal Details
          </Button>
        </Form>
      </Card>
      <AutofillPreferencesCard
        value={preferences}
        busy={busy}
        onSave={savePreferences}
      />
      <StructuredResumeEditor
        client={client}
        apiBaseUrl={apiBaseUrl}
        resumeId={id}
        profile={profile}
        onSaved={(next) => {
          setProfile(next);
          notify("success", "Structured Resume saved.");
        }}
        onNotify={notify}
      />
    </div>
  );
}
