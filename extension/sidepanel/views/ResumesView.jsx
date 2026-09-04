import React, { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Collapse,
  Divider,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import { ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import {
  createResume,
  findActiveChecksum,
  listResumes,
  setResumeStatus,
  updateResumeMetadata,
  openResumeFile,
} from "../../services/resume-service.js";
import { parseResumeFile, sha256Hex } from "../../services/resume-parser.js";
import { parseResumeSections } from "../../shared/structured-parsing.js";
import { skillsFromResumeSection } from "../../shared/skill-detection.js";
import { SENIORITY_VALUES } from "../../shared/seniority.js";
import { ResumeCard } from "../components/ResumeCard.jsx";

const { Text } = Typography;
const { TextArea } = Input;

const SENIORITY_OPTIONS = SENIORITY_VALUES.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));
const split = (value) => String(value || "").split(",").map((x) => x.trim()).filter(Boolean);

export function ResumesView({ client, backendBaseUrl, userId, categories, canWrite, onStatus, onError }) {
  const { modal } = AntdApp.useApp();
  const [status, setStatus] = useState("ACTIVE");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState(null);

  const [uploadForm] = Form.useForm();
  const uploadCategories = Form.useWatch("resumeCategories", uploadForm) || [];
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadChecksum, setUploadChecksum] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploading, setUploading] = useState(false);

  const [editForm] = Form.useForm();
  const editCategories = Form.useWatch("primaryCategoryIds", editForm) || [];
  const [editingResume, setEditingResume] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const categoryOptions = categories.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name }));
  const categoryName = (id) => categories.find((c) => c.id === id)?.name;
  const stackLabel = (resume) => {
    const ids = [...new Set((resume.tech_stacks || [{ primary_category_id: resume.primary_category_id }]).map((row) => row.primary_category_id).filter(Boolean))];
    return ids.map((id) => categoryName(id) || "Unknown").join(", ") || "Unknown";
  };
  const subcategoryOptions = (selectedPrimaryIds) =>
    categories
      .filter((c) => c.parent_id && (selectedPrimaryIds || []).includes(c.parent_id))
      .map((c) => ({
        value: c.id,
        label: `${categoryName(c.parent_id) || ""} · ${c.name}`.replace(/^ · /, c.name),
      }));
  const pruneSubcategories = (form, primaryField, subField, nextPrimaries) => {
    const allowed = new Set(nextPrimaries || []);
    const current = form.getFieldValue(subField) || [];
    form.setFieldValue(
      subField,
      current.filter((id) => {
        const row = categories.find((c) => c.id === id);
        return row?.parent_id && allowed.has(row.parent_id);
      }),
    );
  };

  async function reload() {
    try {
      const rows = await listResumes(client, backendBaseUrl, { status, categoryId, search });
      setItems(rows);
    } catch (error) {
      onError(error);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileChange(file) {
    setUploadFile(file);
    setUploadProgress("Reading file · Extracting text");
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseResumeFile(file);
      const sections = parseResumeSections(parsed.text);
      uploadForm.setFieldsValue({
        resumeText: parsed.text,
        resumeSummary: sections.summary,
        resumeExperience: sections.professional_experience,
        resumeEducation: sections.education,
        resumeSkillsSection: sections.skills,
        resumeSkills: skillsFromResumeSection(sections.skills, parsed.text).join(", "),
      });
      setUploadProgress("Computing checksum");
      setUploadChecksum(await sha256Hex(buffer));
      setUploadProgress(`Ready${parsed.warnings?.length ? ` · ${parsed.warnings.join("; ")}` : ""}`);
    } catch (error) {
      onError(error);
      setUploadProgress("Failed");
    }
  }

  async function submitUpload(values) {
    if (!uploadFile) {
      onStatus({ message: "Choose a resume file.", kind: "error" });
      return;
    }
    setUploading(true);
    try {
      const duplicate = await findActiveChecksum(client, backendBaseUrl, uploadChecksum);
      if (duplicate) {
        const confirmed = await new Promise((resolvePromise) => {
          modal.confirm({
            title: "Duplicate file",
            content: `This file matches active resume "${duplicate.resume_name}". Create another categorized record anyway?`,
            onOk: () => resolvePromise(true),
            onCancel: () => resolvePromise(false),
          });
        });
        if (!confirmed) return;
      }
      setUploadProgress("Uploading original file · Saving structured resume metadata");
      await createResume(
        client,
        backendBaseUrl,
        userId,
        {
          candidateName: values.candidateName,
          resumeName: values.resumeName,
          primaryCategoryIds: values.resumeCategories || [],
          subcategoryIds: values.resumeSubcategories || [],
          primaryCategoryId: values.resumeCategories?.[0],
          subcategoryId: values.resumeSubcategories?.[0],
          seniority: values.resumeSeniority,
          skills: split(values.resumeSkills),
          industries: split(values.industries),
          resumeText: values.resumeText,
          structuredContent: {
            summary: (values.resumeSummary || "").trim(),
            professional_experience: (values.resumeExperience || "").trim(),
            education: (values.resumeEducation || "").trim(),
            skills: (values.resumeSkillsSection || "").trim(),
          },
        },
        uploadFile,
        uploadChecksum,
      );
      setUploadProgress("Completed");
      onStatus({ message: "Resume uploaded privately with structured sections saved.", kind: "success" });
      uploadForm.resetFields();
      setUploadFile(null);
      setUploadChecksum("");
      await reload();
    } catch (error) {
      setUploadProgress("Failed");
      onError(error);
    } finally {
      setUploading(false);
    }
  }

  function openEdit(resume) {
    const stacks = resume.tech_stacks?.length
      ? resume.tech_stacks
      : [{ primary_category_id: resume.primary_category_id, subcategory_id: resume.subcategory_id }];
    editForm.setFieldsValue({
      candidateName: resume.candidate_name,
      resumeName: resume.resume_name,
      primaryCategoryIds: [...new Set(stacks.map((row) => row.primary_category_id).filter(Boolean))],
      subcategoryIds: [...new Set(stacks.map((row) => row.subcategory_id).filter(Boolean))],
      seniority: resume.seniority,
      skills: resume.skills.join(", "),
      industries: resume.industries.join(", "),
    });
    setEditingResume(resume);
  }

  async function submitEdit(values) {
    setSavingEdit(true);
    try {
      await updateResumeMetadata(client, backendBaseUrl, editingResume.id, {
        candidateName: values.candidateName,
        resumeName: values.resumeName,
        primaryCategoryIds: values.primaryCategoryIds || [],
        subcategoryIds: values.subcategoryIds || [],
        seniority: values.seniority,
        skills: split(values.skills),
        industries: split(values.industries),
      });
      onStatus({ message: "Resume metadata updated.", kind: "success" });
      setEditingResume(null);
      await reload();
    } catch (error) {
      onError(error);
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleStatus(resume) {
    try {
      await setResumeStatus(client, backendBaseUrl, resume.id, resume.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE");
      await reload();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 140 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              listResumes(client, backendBaseUrl, { status: value, categoryId, search }).then(setItems).catch(onError);
            }}
            options={[{ value: "ACTIVE", label: "Active" }, { value: "ARCHIVED", label: "Archived" }, { value: "ALL", label: "All" }]}
          />
          <Select
            style={{ width: 180 }}
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              listResumes(client, backendBaseUrl, { status, categoryId: value, search }).then(setItems).catch(onError);
            }}
            options={[{ value: "", label: "All categories" }, ...categoryOptions]}
          />
          <Input
            style={{ width: 180 }}
            placeholder="Candidate search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onPressEnter={reload}
            onBlur={reload}
          />
          <Button icon={<ReloadOutlined />} onClick={reload}>
            Refresh
          </Button>
        </Space>
        {canWrite && (
          <Collapse
            items={[
              {
                key: "upload",
                label: "Upload Resume",
                children: (
                  <Form form={uploadForm} layout="vertical" onFinish={submitUpload}>
                    <Form.Item label="Candidate name" name="candidateName" rules={[{ required: true, max: 200 }]}>
                      <Input maxLength={200} />
                    </Form.Item>
                    <Form.Item label="Resume name" name="resumeName" rules={[{ required: true, max: 200 }]}>
                      <Input maxLength={200} />
                    </Form.Item>
                    <Form.Item
                      label="Primary category"
                      name="resumeCategories"
                      rules={[{ required: true, type: "array", min: 1, message: "Select at least one primary category." }]}
                    >
                      <Select
                        mode="multiple"
                        options={categoryOptions}
                        onChange={(value) => pruneSubcategories(uploadForm, "resumeCategories", "resumeSubcategories", value)}
                      />
                    </Form.Item>
                    <Form.Item label={<>Subcategory <Text type="secondary">(optional)</Text></>} name="resumeSubcategories">
                      <Select
                        mode="multiple"
                        allowClear
                        disabled={!uploadCategories.length}
                        options={subcategoryOptions(uploadCategories)}
                      />
                    </Form.Item>
                    <Form.Item label="Seniority" name="resumeSeniority" initialValue="UNSPECIFIED">
                      <Select options={SENIORITY_OPTIONS} />
                    </Form.Item>
                    <Form.Item label={<>Skills <Text type="secondary">(comma-separated)</Text></>} name="resumeSkills">
                      <Input />
                    </Form.Item>
                    <Form.Item label={<>Industries <Text type="secondary">(comma-separated)</Text></>} name="industries">
                      <Input />
                    </Form.Item>
                    <Form.Item label="Resume file" required>
                      <Upload
                        maxCount={1}
                        accept=".pdf,.docx,.txt"
                        fileList={uploadFile ? [{ uid: "1", name: uploadFile.name, status: "done" }] : []}
                        beforeUpload={(file) => {
                          handleFileChange(file);
                          return false;
                        }}
                        onRemove={() => {
                          setUploadFile(null);
                          setUploadChecksum("");
                          setUploadProgress("");
                        }}
                      >
                        <Button icon={<UploadOutlined />}>Select File</Button>
                      </Upload>
                    </Form.Item>
                    <Form.Item label="Extracted text preview" name="resumeText" rules={[{ required: true }]}>
                      <TextArea rows={12} />
                    </Form.Item>
                    <Divider orientation="left" plain>
                      Structured resume sections — review before saving
                    </Divider>
                    <Form.Item label="Summary" name="resumeSummary">
                      <TextArea rows={5} />
                    </Form.Item>
                    <Form.Item label="Professional Experience" name="resumeExperience">
                      <TextArea rows={10} />
                    </Form.Item>
                    <Form.Item label="Education" name="resumeEducation">
                      <TextArea rows={5} />
                    </Form.Item>
                    <Form.Item label="Skills Section" name="resumeSkillsSection">
                      <TextArea rows={5} />
                    </Form.Item>
                    <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                      {uploadProgress}
                    </Text>
                    <Button type="primary" htmlType="submit" loading={uploading}>
                      Save Resume
                    </Button>
                  </Form>
                ),
              },
            ]}
          />
        )}
      </Card>
      {!items ? null : !items.length ? (
        <Card>
          <Empty description="No resumes match this view." />
        </Card>
      ) : (
        items.map((resume) => (
          <ResumeCard
            key={resume.id}
            resume={resume}
            categoryName={stackLabel(resume)}
            canWrite={canWrite}
            onOpen={() =>
              openResumeFile(client, backendBaseUrl, resume.id, resume.original_filename).catch(onError)
            }
            onEdit={() => openEdit(resume)}
            onToggleStatus={() => toggleStatus(resume)}
          />
        ))
      )}
      {editingResume && (
        <Card
          title={`Edit ${editingResume.candidate_name}`}
          style={{ marginTop: 12 }}
          extra={
            <Button size="small" onClick={() => setEditingResume(null)}>
              Close
            </Button>
          }
        >
          <Form form={editForm} layout="vertical" onFinish={submitEdit}>
            <Form.Item label="Candidate name" name="candidateName" rules={[{ required: true, max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item label="Resume name" name="resumeName" rules={[{ required: true, max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item label="Primary category" name="primaryCategoryIds" rules={[{ required: true, type: "array", min: 1 }]}>
              <Select
                mode="multiple"
                options={categoryOptions}
                onChange={(value) => pruneSubcategories(editForm, "primaryCategoryIds", "subcategoryIds", value)}
              />
            </Form.Item>
            <Form.Item label={<>Subcategory <Text type="secondary">(optional)</Text></>} name="subcategoryIds">
              <Select
                mode="multiple"
                allowClear
                disabled={!editCategories.length}
                options={subcategoryOptions(editCategories)}
              />
            </Form.Item>
            <Form.Item label="Seniority" name="seniority">
              <Select options={SENIORITY_OPTIONS} />
            </Form.Item>
            <Form.Item label={<>Skills <Text type="secondary">(comma-separated)</Text></>} name="skills">
              <Input />
            </Form.Item>
            <Form.Item label={<>Industries <Text type="secondary">(comma-separated)</Text></>} name="industries">
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={savingEdit}>
              Save changes
            </Button>
          </Form>
        </Card>
      )}
    </>
  );
}
