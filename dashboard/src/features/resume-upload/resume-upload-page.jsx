import React, { useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
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
import { CertificationEditor, EducationEditor } from "./education-editor.jsx";
import { resolveSubcategoryId } from "./resume-structure.js";
import { TabbedSections } from "../../components/ui.jsx";

const { Text, Title } = Typography,
  { Dragger } = Upload,
  emptyDraft = () => ({
    candidateName: "",
    candidateFirstName: "",
    candidateMiddleName: "",
    candidateLastName: "",
    candidateEmail: "",
    candidatePhone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    country: "",
    linkedInUrl: "",
    githubUrl: "",
    portfolioUrl: "",
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
      education: [],
      education_legacy_text: "",
      certifications: [],
      skills: "",
    },
    checksum: "",
    reviewConfirmed: false,
  });

export function AdminResumeUploadPage({ client, apiBaseUrl, access, categories }) {
  const { modal } = AntApp.useApp(),
    [file, setFile] = useState(),
    [draft, setDraft] = useState(emptyDraft),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [activeTab, setActiveTab] = useState("identity"),
    [details, setDetails] = useState();
  const subcategories = useMemo(
      () => categories.childrenByParent.get(draft.primaryCategoryId) || [],
      [categories, draft.primaryCategoryId],
    ),
    setField = (name, value) =>
      setDraft((current) => ({ ...current, [name]: value, ...(name === "reviewConfirmed" ? {} : { reviewConfirmed: false }) })),
    setSection = (name, value) =>
      setDraft((current) => ({
        ...current,
        structuredContent: { ...current.structuredContent, [name]: value },
        reviewConfirmed: false,
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
        subcategory = categories.bySlug.get(parsed.subcategorySlug),
        extracted=parsed.structuredContent,
        structuredContent={...extracted,education_legacy_text:Array.isArray(extracted.education)?extracted.education_legacy_text||"":extracted.education||"",education:Array.isArray(extracted.education)?extracted.education:[],certifications:Array.isArray(extracted.certifications)?extracted.certifications:[]};
      setDraft({
        candidateName: parsed.candidateName,
        candidateFirstName: parsed.candidateFirstName,
        candidateMiddleName: parsed.candidateMiddleName,
        candidateLastName: parsed.candidateLastName,
        candidateEmail: parsed.candidateEmail,
        candidatePhone: parsed.candidatePhone,
        addressLine1: "",
        addressLine2: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        country: "",
        linkedInUrl: "",
        githubUrl: "",
        portfolioUrl: "",
        resumeName: parsed.resumeName,
        primaryCategoryId: primary?.id || "",
        subcategoryId: resolveSubcategoryId(primary, subcategory),
        seniority: parsed.seniority,
        skills: parsed.skills.join(", "),
        industries: parsed.industries.join(", "),
        resumeText: parsed.resumeText,
        structuredContent,
        checksum: parsed.checksum,
        reviewConfirmed: false,
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
      const identityFields = [
        "candidateName",
        "candidateFirstName",
        "candidateLastName",
        "candidateEmail",
        "candidatePhone",
        "resumeName",
        "primaryCategoryId",
        "subcategoryId",
        "seniority",
        "linkedInUrl",
        "githubUrl",
        "portfolioUrl",
        "reviewConfirmed",
        "file",
        "checksum",
      ];
      const nextTab = Object.keys(check.errors).some((key) => identityFields.includes(key))
        ? "identity"
        : Object.keys(check.errors).some((key) => key === "structuredContent")
          ? "structured"
          : "identity";
      setActiveTab(nextTab);
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
        "Resume uploaded successfully. The private PDF and verified Resume metadata were saved together.",
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
    <div className="page narrow-page resume-upload-page">
      <Button type="link" className="back-link" href="#/resumes">
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
      {!draft.resumeText && error && <Alert type="error" showIcon message={error} />}
      {message && <Alert type="success" showIcon message={message} />}
      <form className="resume-upload-form" noValidate onSubmit={submit}>
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
            <p className="upload-file-meta">
              <Text type="secondary">{fileDetails}</Text>
            </p>
          )}
          {progress && <Alert type="info" showIcon message={progress} />}
        </Card>
        {draft.resumeText && (
          <TabbedSections
            activeKey={activeTab}
            onChange={setActiveTab}
            extra={
              <Space direction="vertical" size="small" style={{ alignItems: "flex-end" }}>
                {error && <Alert type="error" showIcon message={error} style={{ maxWidth: 420 }} />}
                <Space wrap>
                  <Checkbox checked={draft.reviewConfirmed} onChange={(event)=>setField("reviewConfirmed",event.target.checked)}>Reviewed and accurate</Checkbox>
                  <Button type="primary" htmlType="submit" loading={busy}>
                    Save Resume
                  </Button>
                  <Button href="#/resumes">Cancel</Button>
                </Space>
              </Space>
            }
            items={[
              {
                key: "identity",
                label: "Personal & classification",
                children: (
                  <Card
                    className="resume-upload-section"
                    bordered={false}
                    title="Review extracted Resume information"
                  >
                    <Row gutter={[16, 16]}>
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
                      <Col xs={24} md={8}><label>First name<Input value={draft.candidateFirstName} onChange={(event)=>setField("candidateFirstName",event.target.value)} maxLength={100}/></label></Col>
                      <Col xs={24} md={8}><label>Middle name (optional)<Input value={draft.candidateMiddleName} onChange={(event)=>setField("candidateMiddleName",event.target.value)} maxLength={100}/></label></Col>
                      <Col xs={24} md={8}><label>Last name<Input value={draft.candidateLastName} onChange={(event)=>setField("candidateLastName",event.target.value)} maxLength={100}/></label></Col>
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
                                reviewConfirmed: false,
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
                      <Col span={24}><Title level={4}>Address and professional links</Title></Col>
                      <Col xs={24} md={12}><label>Address line 1<Input value={draft.addressLine1} onChange={(event)=>setField("addressLine1",event.target.value)} maxLength={200}/></label></Col>
                      <Col xs={24} md={12}><label>Address line 2<Input value={draft.addressLine2} onChange={(event)=>setField("addressLine2",event.target.value)} maxLength={200}/></label></Col>
                      <Col xs={24} md={6}><label>City<Input value={draft.city} onChange={(event)=>setField("city",event.target.value)} maxLength={120}/></label></Col>
                      <Col xs={24} md={6}><label>State / region<Input value={draft.stateRegion} onChange={(event)=>setField("stateRegion",event.target.value)} maxLength={120}/></label></Col>
                      <Col xs={24} md={6}><label>Postal code<Input value={draft.postalCode} onChange={(event)=>setField("postalCode",event.target.value)} maxLength={40}/></label></Col>
                      <Col xs={24} md={6}><label>Country<Input value={draft.country} onChange={(event)=>setField("country",event.target.value)} maxLength={120}/></label></Col>
                      <Col xs={24} md={8}><label>LinkedIn URL<Input type="url" value={draft.linkedInUrl} onChange={(event)=>setField("linkedInUrl",event.target.value)} maxLength={2000}/></label></Col>
                      <Col xs={24} md={8}><label>GitHub URL<Input type="url" value={draft.githubUrl} onChange={(event)=>setField("githubUrl",event.target.value)} maxLength={2000}/></label></Col>
                      <Col xs={24} md={8}><label>Portfolio URL<Input type="url" value={draft.portfolioUrl} onChange={(event)=>setField("portfolioUrl",event.target.value)} maxLength={2000}/></label></Col>
                    </Row>
                    <Alert
                      type="info"
                      showIcon
                      message="Duplicate candidates are checked using the normalized name, email, and phone together. Review all three before saving."
                    />
                    {categoryDetails && (
                      <Alert type="info" showIcon message={categoryDetails} />
                    )}
                    <Alert type="warning" showIcon message="Verification is part of this upload" description="Review the personal fields and structured Resume tabs. Autofill uses the values saved here; no second verification step is required for this Resume." />
                  </Card>
                ),
              },
              {
                key: "structured",
                label: "Structured Resume",
                children: (
                  <Card className="resume-upload-section" bordered={false} title="Structured Resume">
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
                        Legacy extracted education text
                        <Input.TextArea
                          value={draft.structuredContent.education_legacy_text}
                          onChange={(event) =>
                            setSection("education_legacy_text", event.target.value)
                          }
                          autoSize={{ minRows: 5, maxRows: 12 }}
                        />
                      </label>
                      <EducationEditor items={draft.structuredContent.education} onChange={(value)=>setSection("education",value)}/>
                      <CertificationEditor items={draft.structuredContent.certifications} onChange={(value)=>setSection("certifications",value)}/>
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
                  <Card className="resume-upload-section" bordered={false}>
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
