import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import {
  EditOutlined,
  HighlightOutlined,
  ReloadOutlined,
  SaveOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import { MESSAGE_TYPES } from "../../shared/messages.js";
import { normalizeUrl } from "../../shared/normalization.js";
import { suggestControlledCategory } from "../../shared/categories.js";
import { normalizeSeniority, SENIORITY_VALUES } from "../../shared/seniority.js";
import { canonicalizeSkills, detectSkills } from "../../shared/skill-detection.js";
import { detectJobConditions } from "../../shared/structured-parsing.js";
import { detectIndustryDomain as detectIndustryDomainSlug } from "../../shared/industry-domain.js";
import { detectSalary, SALARY_PERIODS } from "../../shared/salary-detection.js";
import { CLEARANCE_REQUIREMENTS, validateJob, WORK_ARRANGEMENTS } from "../../shared/validation.js";
import { scoreMatch, summarizeBatch } from "../../shared/matching.js";
import { createJob } from "../../services/job-service.js";
import { eligibleResumes } from "../../services/resume-service.js";
import { createTailoringJobs } from "../../services/tailoring-job-service.js";
import { MatchCard } from "../components/MatchCard.jsx";

const { Text } = Typography;
const { TextArea } = Input;

const CLEARANCE_LABELS = {
  PUBLIC_TRUST: "Public Trust",
  DOD_SECRET: "DoD / Secret",
  TOP_SECRET: "Top Secret",
  TS_SCI: "TS/SCI",
  OTHER_SECURITY_CLEARANCE: "Other security clearance",
};
const CLEARANCE_OPTIONS = CLEARANCE_REQUIREMENTS.map((value) => ({
  value,
  label: CLEARANCE_LABELS[value] || value,
}));
const WORK_ARRANGEMENT_LABELS = {
  UNSPECIFIED: "Unspecified",
  REMOTE: "Fully remote",
  HYBRID: "Hybrid",
  ONSITE: "Onsite",
};
const WORK_ARRANGEMENT_OPTIONS = ["UNSPECIFIED", ...WORK_ARRANGEMENTS.filter((v) => v !== "UNSPECIFIED")].map(
  (value) => ({ value, label: WORK_ARRANGEMENT_LABELS[value] }),
);
const SALARY_PERIOD_LABELS = { HOUR: "Hourly", DAY: "Daily", WEEK: "Weekly", MONTH: "Monthly", YEAR: "Yearly", OTHER: "Other" };
const SALARY_PERIOD_OPTIONS = [
  { value: "", label: "Not specified" },
  ...SALARY_PERIODS.map((value) => ({ value, label: SALARY_PERIOD_LABELS[value] || value })),
];
const SENIORITY_OPTIONS = SENIORITY_VALUES.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));
const TRAVEL_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "true", label: "Travel required" },
  { value: "false", label: "No travel required" },
];
const CAPTURE_METHOD_MAP = {
  json_ld: "json-ld",
  known_selector: "site-specific",
  generic_selector: "dom",
  main_fallback: "dom",
  selection: "selected-text",
  manual: "manual",
};

const split = (value) => String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
const optionalNumber = (value) => (String(value ?? "").trim() === "" ? null : Number(value));

const DEFAULT_VALUES = {
  company: "",
  jobTitle: "",
  jobCategory: undefined,
  jobSubcategory: undefined,
  industryDomain: "",
  jobSeniority: "UNSPECIFIED",
  jobLocation: "",
  workArrangement: "UNSPECIFIED",
  clearanceRequirements: [],
  travelRequired: "",
  travelDetails: "",
  salaryText: "",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "",
  salaryPeriod: "",
  sourceSite: "",
  sourceUrl: "",
  descriptionText: "",
  detectedSkills: "",
};

export function CaptureView({ client, backendBaseUrl, userId, categories, industryDomains, minimumScore, canWrite, canCreateTailoring=false, onStatus, onError }) {
  const [form] = Form.useForm();
  const { modal } = AntdApp.useApp();
  const [captureMethod, setCaptureMethod] = useState("manual");
  const [confidence, setConfidence] = useState("low");
  const [activeUrl, setActiveUrl] = useState("");
  const [urlEditable, setUrlEditable] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedJob, setSavedJob] = useState(null);
  const [duplicateJob, setDuplicateJob] = useState(null);
  const [matches, setMatches] = useState([]);
  const [selectedResumeIds, setSelectedResumeIds] = useState(new Set());
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const draftTimer = useRef(null);
  const latestDraft = useRef(null);
  const draftKey = `capture-current:${userId || "anonymous"}`;
  const jobCategoryValue = Form.useWatch("jobCategory", form);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local
      .get(draftKey)
      .then((stored) => {
        const draft = stored[draftKey];
        if (cancelled || !draft?.formValues) return;
        latestDraft.current = draft;
        form.setFieldsValue({ ...DEFAULT_VALUES, ...draft.formValues });
        setCaptureMethod(draft.captureMethod || "manual");
        setConfidence(draft.confidence || "low");
        setActiveUrl(draft.activeUrl || draft.formValues.sourceUrl || "");
        setUrlEditable(Boolean(draft.urlEditable));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(draftTimer.current);
      const pending = latestDraft.current;
      if (pending) chrome.storage.local.set({ [draftKey]: pending }).catch(() => {});
    };
  }, [draftKey, form]);

  const categoryOptions = useMemo(
    () => categories.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );
  const subcategoryOptions = useMemo(
    () => categories.filter((c) => c.parent_id === jobCategoryValue).map((c) => ({ value: c.id, label: c.name })),
    [categories, jobCategoryValue],
  );
  const industryOptions = useMemo(
    () => [{ value: "", label: "Unspecified" }, ...industryDomains.map((d) => ({ value: d.id, label: d.name }))],
    [industryDomains],
  );

  function saveDraft(values = form.getFieldsValue()) {
    const draft = {
      version: 1,
      formValues: values,
      captureMethod,
      confidence,
      activeUrl: activeUrl || values.sourceUrl || "",
      urlEditable,
      updatedAt: new Date().toISOString(),
    };
    latestDraft.current = draft;
    return chrome.storage.local.set({ [draftKey]: draft });
  }

  function scheduleDraftSave(_changedValues, allValues) {
    clearTimeout(draftTimer.current);
    const draft = {
      version: 1,
      formValues: allValues,
      captureMethod,
      confidence,
      activeUrl: activeUrl || allValues.sourceUrl || "",
      urlEditable,
      updatedAt: new Date().toISOString(),
    };
    latestDraft.current = draft;
    draftTimer.current = setTimeout(() => {
      chrome.storage.local.set({ [draftKey]: draft }).catch(() => {});
    }, 150);
  }

  function jobPayload() {
    const values = form.getFieldsValue();
    const travel = values.travelRequired;
    return {
      company: (values.company || "").trim(),
      jobTitle: (values.jobTitle || "").trim(),
      categoryId: values.jobCategory,
      subcategoryId: values.jobSubcategory || null,
      industryDomainCategoryId: values.industryDomain || null,
      seniority: values.jobSeniority,
      locationText: (values.jobLocation || "").trim() || null,
      workArrangement: values.workArrangement,
      clearanceRequirements: values.clearanceRequirements || [],
      travelRequired: travel === "" || travel == null ? null : travel === "true",
      travelDetails: (values.travelDetails || "").trim() || null,
      salaryMin: optionalNumber(values.salaryMin),
      salaryMax: optionalNumber(values.salaryMax),
      salaryCurrency: (values.salaryCurrency || "").trim().toUpperCase() || null,
      salaryPeriod: values.salaryPeriod || null,
      salaryText: (values.salaryText || "").trim() || null,
      sourceSite: (values.sourceSite || "").trim(),
      sourceUrl: (values.sourceUrl || "").trim(),
      descriptionText: (values.descriptionText || "").trim(),
      detectedSkills: canonicalizeSkills(split(values.detectedSkills)),
      captureMethod,
      extractionConfidence: confidence,
    };
  }

  function resetCapture() {
    clearTimeout(draftTimer.current);
    latestDraft.current = null;
    form.resetFields();
    setCaptureMethod("manual");
    setConfidence("low");
    setActiveUrl("");
    setUrlEditable(false);
    setSavedJob(null);
    setDuplicateJob(null);
    setMatches([]);
    setSelectedResumeIds(new Set());
  }

  function resetCaptureAndDiscardDraft() {
    resetCapture();
    chrome.storage.local.remove(draftKey).catch(() => {});
    onStatus({ message: "Current capture reset.", kind: "success" });
  }

  async function extract(type) {
    setExtracting(true);
    onStatus({ message: "Extracting the active page…", kind: "warning" });
    try {
      const response = await chrome.runtime.sendMessage({ type });
      if (!response.ok) {
        onStatus({
          message: `${response.error.message}${response.error.details ? ` ${response.error.details}` : ""}`,
          kind: "error",
        });
        return;
      }
      resetCapture();
      const d = response.data;
      const conditions = detectJobConditions({
        title: d.jobTitle,
        description: d.jobDescription,
        location: d.location,
        workArrangement: d.workArrangement,
      });
      const salary = detectSalary(d.jobDescription, d.salary);
      const industryDomainId =
        industryDomains.find((domain) => domain.slug === detectIndustryDomainSlug(d.jobTitle, d.jobDescription))?.id ||
        "";
      form.setFieldsValue({
        company: d.company || "",
        jobTitle: d.jobTitle || "",
        industryDomain: industryDomainId,
        jobLocation: conditions.locationText || "",
        workArrangement: conditions.workArrangement,
        clearanceRequirements: conditions.clearanceRequirements,
        travelRequired: conditions.travelRequired === null ? "" : String(conditions.travelRequired),
        travelDetails: conditions.travelDetails || "",
        salaryText: salary.text || "",
        salaryMin: salary.min ?? null,
        salaryMax: salary.max ?? null,
        salaryCurrency: salary.currency || "",
        salaryPeriod: salary.period || "",
        sourceSite: d.sourceSite || "",
        sourceUrl: d.sourceUrl || "",
        descriptionText: d.jobDescription || "",
        detectedSkills: detectSkills(d.jobDescription).join(", "),
        jobSeniority: normalizeSeniority(d.jobTitle),
      });
      setCaptureMethod(CAPTURE_METHOD_MAP[d.captureMethod] || "manual");
      setConfidence(d.extractionConfidence || "low");
      const suggestion = suggestControlledCategory(d.jobTitle, d.jobDescription);
      const category = categories.find((c) => !c.parent_id && c.slug === suggestion.categorySlug);
      if (category && suggestion.confidence !== "low") {
        form.setFieldValue("jobCategory", category.id);
        const sub = categories.find((c) => c.parent_id === category.id && c.slug === suggestion.subcategorySlug);
        if (sub) form.setFieldValue("jobSubcategory", sub.id);
      }
      const nextActiveUrl = normalizeUrl(d.sourceUrl) || d.sourceUrl;
      setActiveUrl(nextActiveUrl);
      const extractedDraft = {
          version: 1,
          formValues: form.getFieldsValue(),
          captureMethod: CAPTURE_METHOD_MAP[d.captureMethod] || "manual",
          confidence: d.extractionConfidence || "low",
          activeUrl: nextActiveUrl || "",
          urlEditable: false,
          updatedAt: new Date().toISOString(),
      };
      latestDraft.current = extractedDraft;
      await chrome.storage.local.set({ [draftKey]: extractedDraft });
      onStatus({
        message:
          "Job extracted. Review the detected salary, technology stack, industry domain, and requirements before saving.",
      });
    } catch (error) {
      onError(error);
    } finally {
      setExtracting(false);
    }
  }

  function confirmClearance(clearanceRequirements) {
    if (!clearanceRequirements.length) return Promise.resolve(true);
    const requirements = clearanceRequirements.map((v) => CLEARANCE_LABELS[v] || v).join(", ");
    return new Promise((resolvePromise) => {
      modal.confirm({
        title: "Security requirement detected",
        content: `${requirements}. Confirm that you reviewed the job posting and want to save this requirement.`,
        okText: "Confirm",
        cancelText: "Cancel",
        onOk: () => resolvePromise(true),
        onCancel: () => resolvePromise(false),
      });
    });
  }

  async function loadMatches(job) {
    if(!canCreateTailoring){setMatches([]);return;}
    if (!job) return;
    setLoadingMatches(true);
    try {
      const resumes = await eligibleResumes(client, backendBaseUrl, job.category_id);
      const ranked = resumes
        .map((r) => ({
          resume: r,
          details: scoreMatch(
            {
              categoryId: job.category_id,
              subcategoryId: job.subcategory_id,
              seniority: job.seniority,
              detectedSkills: job.detected_skills,
            },
            {
              id: r.id,
              primaryCategoryId: r.primary_category_id,
              subcategoryId: r.subcategory_id,
              seniority: r.seniority,
              skills: r.skills,
              updatedAt: r.updated_at,
            },
            minimumScore,
          ),
        }))
        .sort((a, b) => b.details.total - a.details.total);
      setMatches(ranked);
      setSelectedResumeIds(new Set(ranked.filter((m) => m.details.eligible).map((m) => m.resume.id)));
    } catch (error) {
      onError(error);
    } finally {
      setLoadingMatches(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const job = jobPayload();
      const validation = validateJob(job);
      if (!validation.valid) {
        onStatus({ message: Object.values(validation.errors).join(" "), kind: "error" });
        return;
      }
      if (!(await confirmClearance(job.clearanceRequirements))) {
        onStatus({
          message: "Save cancelled. Review the trust or security-clearance selections before saving.",
          kind: "warning",
        });
        return;
      }
      const saved = await createJob(client, backendBaseUrl, job);
      setSavedJob(saved);
      setDuplicateJob(saved.duplicate?saved:null);
      if(saved.duplicate){
        const duplicateMessage=saved.duplicate_reason === "COMPANY_JOB_TITLE"
          ? "Not saved: a JD with the same company and job title already exists. The existing JD is shown."
          : "Not saved: this source URL already exists. The existing JD is shown.";
        onStatus({message:`${duplicateMessage}${saved.workspace_sync?.enabled?` Google Sheets sync: ${saved.workspace_sync.status}.`:""}`,kind:"warning"});
        await loadMatches(saved);
        return;
      }
      const sync=saved.workspace_sync;
      onStatus(sync?.enabled&&sync.status!=="SUCCEEDED"
        ?{message:`JD saved to Supabase, but Google Sheets sync ${sync.status==="PENDING"?"is already in progress":"failed"}. Saving this JD again will retry safely.`,kind:"warning"}
        :{message:`JD saved to ${sync?.status==="SUCCEEDED"?"Supabase and Google Sheets":"Supabase"}: ${saved.company} — ${saved.job_title}.${saved.review_status==="NEEDS_REVIEW"?" It is waiting for manager review.":""}`,kind:"success"});
      await loadMatches(saved);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTailoringJobs() {
    const chosen = matches.filter((m) => selectedResumeIds.has(m.resume.id));
    if (!chosen.length) {
      onStatus({ message: "Select at least one resume.", kind: "error" });
      return;
    }
    if (chosen.some((m) => !m.details.eligible)) {
      const confirmed = await new Promise((resolvePromise) => {
        modal.confirm({
          title: "Below-threshold selections",
          content: "One or more selections are below the score threshold. Queue them anyway?",
          onOk: () => resolvePromise(true),
          onCancel: () => resolvePromise(false),
        });
      });
      if (!confirmed) return;
    }
    setCreatingJobs(true);
    try {
      const results = await createTailoringJobs(client, backendBaseUrl, userId, savedJob, chosen);
      const summary = summarizeBatch(results);
      onStatus({
        message: `Created: ${summary.created}. Already queued: ${summary.alreadyQueued}. Failed: ${summary.failed}.`,
        kind: summary.failed ? "warning" : "success",
      });
    } catch (error) {
      onError(error);
    } finally {
      setCreatingJobs(false);
    }
  }

  function toggleResume(id, checked) {
    setSelectedResumeIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <>
      <Card className="capture-sticky-bar" size="small" style={{ marginBottom: 12 }}>
        <Flex vertical gap={8}>
          <Button
            block
            icon={<ScanOutlined />}
            loading={extracting}
            onClick={() => extract(MESSAGE_TYPES.EXTRACT_CURRENT_JOB)}
          >
            Extract Current Job
          </Button>
          <Button
            block
            icon={<HighlightOutlined />}
            loading={extracting}
            onClick={() => extract(MESSAGE_TYPES.EXTRACT_SELECTED_TEXT)}
          >
            Use Selected Text
          </Button>
          <Flex gap={8}>
            <Button
              icon={<ReloadOutlined />}
              onClick={resetCaptureAndDiscardDraft}
              style={{ flex: 1 }}
            >
              Reset Current Capture
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!canWrite}
              onClick={() => form.submit()}
              style={{ flex: 1 }}
            >
              Save JD
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Card>
        <Form form={form} layout="vertical" initialValues={DEFAULT_VALUES} onValuesChange={scheduleDraftSave} onFinish={submit}>
          <Form.Item label="Company" name="company" rules={[{ required: true, max: 200, message: "Company must contain 1–200 characters." }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item label="Job title" name="jobTitle" rules={[{ required: true, max: 200, message: "Job title must contain 1–200 characters." }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item label="Primary category" name="jobCategory" rules={[{ required: true, message: "Select a primary category." }]}>
            <Select
              options={categoryOptions}
              placeholder="Select category"
              onChange={() => form.setFieldValue("jobSubcategory", undefined)}
            />
          </Form.Item>
          <Form.Item
            label={<>Subcategory <Text type="secondary">(optional)</Text></>}
            name="jobSubcategory"
          >
            <Select options={subcategoryOptions} placeholder="None" allowClear disabled={!jobCategoryValue} />
          </Form.Item>
          <Form.Item label="Industry domain" name="industryDomain">
            <Select options={industryOptions} />
          </Form.Item>
          <Form.Item label="Seniority" name="jobSeniority">
            <Select options={SENIORITY_OPTIONS} />
          </Form.Item>
          <Form.Item
            label={<>Company location <Text type="secondary">(optional; blank for fully remote)</Text></>}
            name="jobLocation"
          >
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item label="Work arrangement" name="workArrangement">
            <Select options={WORK_ARRANGEMENT_OPTIONS} />
          </Form.Item>
          <Form.Item label="Trust or security clearance requirements" name="clearanceRequirements">
            <Checkbox.Group options={CLEARANCE_OPTIONS} className="clearance-grid" />
          </Form.Item>
          <Form.Item label="Travel requirement" name="travelRequired">
            <Select options={TRAVEL_OPTIONS} />
          </Form.Item>
          <Form.Item label={<>Travel details <Text type="secondary">(optional)</Text></>} name="travelDetails">
            <Input maxLength={500} />
          </Form.Item>
          <Divider orientation="left" plain>
            Salary range (optional)
          </Divider>
          <Form.Item label="Original salary text" name="salaryText">
            <Input maxLength={500} />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item label="Minimum" name="salaryMin" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Maximum" name="salaryMax" style={{ flex: 1 }}>
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Flex>
          <Flex gap={12}>
            <Form.Item label="Currency" name="salaryCurrency" style={{ flex: 1 }}>
              <Input maxLength={3} placeholder="USD" />
            </Form.Item>
            <Form.Item label="Pay period" name="salaryPeriod" style={{ flex: 1 }}>
              <Select options={SALARY_PERIOD_OPTIONS} />
            </Form.Item>
          </Flex>
          <Form.Item label="Source website" name="sourceSite">
            <Input disabled />
          </Form.Item>
          <Form.Item
            label={
              <Space>
                Source URL
                <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setUrlEditable(true)}>
                  Edit
                </Button>
              </Space>
            }
            name="sourceUrl"
          >
            <Input disabled={!urlEditable} maxLength={4000} />
          </Form.Item>
          <Form.Item
            label="Job description"
            name="descriptionText"
            rules={[{ required: true, message: "Description must contain 100–200,000 characters." }]}
          >
            <TextArea rows={16} />
          </Form.Item>
          <Form.Item
            label={<>Detected skills <Text type="secondary">(comma-separated, editable)</Text></>}
            name="detectedSkills"
          >
            <Input />
          </Form.Item>
          <Space style={{ marginBottom: 0 }}>
            <Text type="secondary">
              Capture method: <Text strong>{captureMethod}</Text>
            </Text>
            <Text type="secondary">
              Confidence: <Text strong>{confidence}</Text>
            </Text>
          </Space>
        </Form>
      </Card>
      {canCreateTailoring && matches.length > 0 && (
        <Card title="Matching active resumes" style={{ marginTop: 12 }} loading={loadingMatches}>
          {matches.map((match) => (
            <MatchCard
              key={match.resume.id}
              match={match}
              checked={selectedResumeIds.has(match.resume.id)}
              onToggle={toggleResume}
            />
          ))}
          <Button type="primary" onClick={handleCreateTailoringJobs} loading={creatingJobs} disabled={!canWrite}>
            Create Tailoring Jobs
          </Button>
        </Card>
      )}
    </>
  );
}
