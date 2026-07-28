import React, { useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Collapse,
  Flex,
  Input,
  Row,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { SENIORITIES } from "../../shared/constants.js";
import { formatBytes, formatLabel } from "../../shared/formatters.js";
import {
  findResumesByIdentity,
  uploadAdminResume,
  validateResumeUpload,
} from "./resume-upload-service.js";
import { ExperienceEditor } from "./experience-editor.jsx";
import { TabbedSections } from "../../components/ui.jsx";

const { Text, Title } = Typography,
  { Dragger } = Upload,
  emptyDraft = () => ({
    candidateName: "",
    candidateEmail: "",
    candidatePhone: "",
    resumeName: "",
    primaryCategoryId: "",
    subcategoryId: "",
    seniority: "UNSPECIFIED",
    skills: "",
    industries: "",
    resumeText: "",
    structuredContent: {
      summary: "",
      professional_experience: [],
      education: "",
      skills: "",
    },
    checksum: "",
  });

export function AdminResumeUploadPage({ client, apiBaseUrl, access, categories }) {
  const { modal } = AntApp.useApp(),
    [file, setFile] = useState(),
    [draft, setDraft] = useState(emptyDraft),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [details, setDetails] = useState();
  const subcategories = useMemo(
      () => categories.childrenByParent.get(draft.primaryCategoryId) || [],
      [categories, draft.primaryCategoryId],
    ),
    setField = (name, value) =>
      setDraft((current) => ({ ...current, [name]: value })),
    setSection = (name, value) =>
      setDraft((current) => ({
        ...current,
        structuredContent: { ...current.structuredContent, [name]: value },
      }));

  async function choose(selected) {
    setFile(selected);
    setError("");
    setMessage("");
    setDetails();
    if (!selected) {
      setDraft(emptyDraft());
      setProgress("");
      return;
    }
    setBusy(true);
    setProgress("Reading the PDF and extracting text…");
    try {
      const { parsePdfResume } = await import("./resume-upload-parser.js"),
        parsed = await parsePdfResume(selected),
        primary = categories.bySlug.get(parsed.categorySlug),
        subcategory = categories.bySlug.get(parsed.subcategorySlug);
      setDraft({
        candidateName: parsed.candidateName,
        candidateEmail: parsed.candidateEmail,
        candidatePhone: parsed.candidatePhone,
        resumeName: parsed.resumeName,
        primaryCategoryId: primary?.id || "",
        subcategoryId:
          subcategory?.parent_id === primary?.id ? subcategory.id : "",
        seniority: parsed.seniority,
        skills: parsed.skills.join(", "),
        industries: parsed.industries.join(", "),
        resumeText: parsed.resumeText,
        structuredContent: parsed.structuredContent,
        checksum: parsed.checksum,
      });
      setDetails({
        pageCount: parsed.pageCount,
        skillCount: parsed.skills.length,
        experienceCount:
          parsed.structuredContent.professional_experience.length,
        categoryConfidence: parsed.categoryConfidence,
        reasons: parsed.reasons,
      });
      setProgress("Extraction completed. Review every field before saving.");
    } catch (cause) {
      setDraft(emptyDraft());
      setError(cause.message);
      setProgress("Extraction failed.");
    } finally {
      setBusy(false);
    }
  }
  const confirmDuplicate = (duplicates) =>
    new Promise((resolve) =>
      modal.confirm({
        title: "Candidate already has a Resume",
        content: (
          <div>
            <p>
              The name, email, and phone match{" "}
              {duplicates.length === 1
                ? "an existing Resume"
                : "existing Resumes"}
              :
            </p>
            {duplicates.map((item) => (
              <p key={item.id}>
                <strong>{item.resume_name}</strong> — {formatLabel(item.status)}{" "}
                · {item.candidate_email} · {item.candidate_phone}
              </p>
            ))}
            <p>Save another Resume record anyway?</p>
          </div>
        ),
        okText: "Save another",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      }),
    );
  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const check = validateResumeUpload(draft, file);
    if (!check.valid) {
      setError(Object.values(check.errors).join(" "));
      return;
    }
    setBusy(true);
    setProgress("Checking for an existing candidate…");
    try {
      const duplicates = await findResumesByIdentity(client, apiBaseUrl, draft);
      if (duplicates.length && !(await confirmDuplicate(duplicates))) {
        setProgress("Upload cancelled.");
        return;
      }
      setProgress(
        "Uploading the private PDF and saving extracted information…",
      );
      const created = await uploadAdminResume(
        client,
        apiBaseUrl,
        access.userId,
        draft,
        file,
      );
      setMessage(
        "Resume uploaded successfully. The private PDF and reviewed structured information were saved.",
      );
      setProgress("Completed.");
      location.assign("#/resumes/" + created.id);
    } catch (cause) {
      setError(cause.message);
      setProgress("Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  const fileDetails = file
      ? file.name +
        " · " +
        formatBytes(file.size) +
        (details
          ? " · " +
            details.pageCount +
            " page" +
            (details.pageCount === 1 ? "" : "s") +
            " · " +
            details.skillCount +
            " detected skills · " +
            details.experienceCount +
            " experience" +
            (details.experienceCount === 1 ? "" : "s")
          : "")
      : "",
    categoryDetails = details?.categoryConfidence
      ? "Category suggestion confidence: " +
        formatLabel(details.categoryConfidence) +
        (details.reasons?.length ? " · " + details.reasons.join("; ") : "") +
        ". Select the correct category before saving."
      : "";
  return (
    <div className="page narrow-page">
      <Button type="link" href="#/resumes">
        ← Back to Resumes
      </Button>
      <Title level={1} tabIndex={-1}>
        Upload Resume
      </Title>
      <Text>
        Admin-only upload. Select a text-based PDF; extraction happens locally
        in the browser and can be reviewed before anything is saved. No AI
        service is used.
      </Text>
      {error && <Alert type="error" showIcon message={error} />}{" "}
      {message && <Alert type="success" showIcon message={message} />}
      <form className="resume-upload-form" onSubmit={submit}>
        <Card title="PDF Resume">
          <Dragger
            accept=".pdf,application/pdf"
            maxCount={1}
            disabled={busy}
            beforeUpload={(selected) => {
              choose(selected);
              return false;
            }}
            onRemove={() => {
              choose();
              return true;
            }}
            fileList={file ? [file] : []}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag a PDF Resume here</p>
            <p className="ant-upload-hint">Text-based PDF, maximum 5 MiB</p>
          </Dragger>
          {fileDetails && (
            <p>
              <Text type="secondary">{fileDetails}</Text>
            </p>
          )}
          {progress && <Alert type="info" showIcon message={progress} />}
        </Card>
        {draft.resumeText && (
          <TabbedSections
            extra={
              <Space>
                <Button type="primary" htmlType="submit" loading={busy}>
                  Save Resume
                </Button>
                <Button href="#/resumes">Cancel</Button>
              </Space>
            }
            items={[
              {
                key: "identity",
                label: "Candidate & classification",
                children: (
                  <Card title="Review extracted Resume information">
                    <Row gutter={[16, 12]}>
                      <Col xs={24} md={12}>
                        <label>
                          Candidate name
                          <Input
                            value={draft.candidateName}
                            onChange={(event) =>
                              setField("candidateName", event.target.value)
                            }
                            maxLength={200}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Resume name
                          <Input
                            value={draft.resumeName}
                            onChange={(event) =>
                              setField("resumeName", event.target.value)
                            }
                            maxLength={200}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Candidate email
                          <Input
                            type="email"
                            value={draft.candidateEmail}
                            onChange={(event) =>
                              setField("candidateEmail", event.target.value)
                            }
                            maxLength={320}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Candidate phone
                          <Input
                            type="tel"
                            value={draft.candidatePhone}
                            onChange={(event) =>
                              setField("candidatePhone", event.target.value)
                            }
                            maxLength={40}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Primary category
                          <Select
                            value={draft.primaryCategoryId || undefined}
                            onChange={(value) =>
                              setDraft((current) => ({
                                ...current,
                                primaryCategoryId: value,
                                subcategoryId: "",
                              }))
                            }
                            options={categories.primary.map((item) => ({
                              value: item.id,
                              label: item.name,
                            }))}
                            style={{ width: "100%" }}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Subcategory (optional)
                          <Select
                            value={draft.subcategoryId || ""}
                            onChange={(value) =>
                              setField("subcategoryId", value)
                            }
                            options={[
                              { value: "", label: "None" },
                              ...subcategories.map((item) => ({
                                value: item.id,
                                label: item.name,
                              })),
                            ]}
                            style={{ width: "100%" }}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Seniority
                          <Select
                            value={draft.seniority}
                            onChange={(value) => setField("seniority", value)}
                            options={SENIORITIES.map((value) => ({
                              value,
                              label: formatLabel(value),
                            }))}
                            style={{ width: "100%" }}
                          />
                        </label>
                      </Col>
                      <Col xs={24} md={12}>
                        <label>
                          Detected skills, comma-separated
                          <Input
                            value={draft.skills}
                            onChange={(event) =>
                              setField("skills", event.target.value)
                            }
                          />
                        </label>
                      </Col>
                      <Col span={24}>
                        <label>
                          Industry experience, comma-separated
                          <Input
                            value={draft.industries}
                            onChange={(event) =>
                              setField("industries", event.target.value)
                            }
                          />
                        </label>
                      </Col>
                    </Row>
                    <Alert
                      type="info"
                      showIcon
                      message="Duplicate candidates are checked using the normalized name, email, and phone together. Review all three before saving."
                    />
                    {categoryDetails && (
                      <Alert type="info" showIcon message={categoryDetails} />
                    )}
                  </Card>
                ),
              },
              {
                key: "structured",
                label: "Structured Resume",
                children: (
                  <Card title="Structured Resume">
                    <Text type="secondary">
                      Correct the extraction and add anything missing before
                      saving.
                    </Text>
                    <div className="structured-editor">
                      <label>
                        Summary
                        <Input.TextArea
                          value={draft.structuredContent.summary}
                          onChange={(event) =>
                            setSection("summary", event.target.value)
                          }
                          autoSize={{ minRows: 4, maxRows: 10 }}
                        />
                      </label>
                      <ExperienceEditor
                        experiences={
                          draft.structuredContent.professional_experience
                        }
                        onChange={(value) =>
                          setSection("professional_experience", value)
                        }
                      />
                      <label>
                        Education
                        <Input.TextArea
                          value={draft.structuredContent.education}
                          onChange={(event) =>
                            setSection("education", event.target.value)
                          }
                          autoSize={{ minRows: 5, maxRows: 12 }}
                        />
                      </label>
                      <label>
                        Skills Section
                        <Input.TextArea
                          value={draft.structuredContent.skills}
                          onChange={(event) =>
                            setSection("skills", event.target.value)
                          }
                          autoSize={{ minRows: 4, maxRows: 10 }}
                        />
                      </label>
                    </div>
                  </Card>
                ),
              },
              {
                key: "original",
                label: "Original text",
                children: (
                  <Card>
                    <Collapse
                      ghost
                      items={[
                        {
                          key: "text",
                          label: "Original extracted Resume text",
                          children: (
                            <Input.TextArea
                              value={draft.resumeText}
                              onChange={(event) =>
                                setField("resumeText", event.target.value)
                              }
                              autoSize={{ minRows: 12, maxRows: 24 }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
            ]}
          />
        )}
      </form>
    </div>
  );
}
