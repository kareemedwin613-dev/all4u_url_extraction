import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App as AntdApp, Button, Flex, Layout, Space, Spin, Tabs, Typography } from "antd";
import {
  FileSearchOutlined,
  HistoryOutlined,
  AuditOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SettingOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import {
  getSupabaseClient,
  loadConfig,
  validateSupabaseConfig,
} from "../services/supabase-client.js";
import { currentSession, signIn, signOut } from "../services/auth-service.js";
import { getMyAccessContext } from "../services/access-service.js";
import { recordLogin } from "../services/session-events-service.js";
import { createPairing, pairingUrl, waitForApproval } from "../services/extension-pairing-service.js";
import {
  canAccessMyApplications,
  canAccessResumeQueue,
  canCreateTailoring,
  canReviewJobs,
  canListOwnJobs,
  canReadBusiness,
  canWriteBusiness,
  canCheckJobDuplicates,
  extensionAccessMessage,
} from "../access/capabilities.js";
import { listCategories } from "../services/category-service.js";
import { listIndustryDomains } from "../services/industry-domain-service.js";
import { clearLookupCaches } from "../services/lookup-cache.js";
import { AppError, safeError } from "../shared/errors.js";
import { PANEL_APPLICATIONS_KEY, panelApplicationItems } from "../shared/page-applications.js";
import { SettingsView } from "./views/SettingsView.jsx";
import { AuthView } from "./views/AuthView.jsx";
import { AccessView } from "./views/AccessView.jsx";
import { CaptureView } from "./views/CaptureView.jsx";
import { MyApplicationsView } from "./views/MyApplicationsView.jsx";
import { ResumesView } from "./views/ResumesView.jsx";
import { QueueView } from "./views/QueueView.jsx";
import { JobReviewView } from "./views/JobReviewView.jsx";
import { MyJobDescriptionsView } from "./views/MyJobDescriptionsView.jsx";
import { getApplicationAutofillContext, getApplicationAutofillRecovery, getApplicationCoverLetterText,getApplicationExtensionContext, listMyApplications, loadApplicationResumeForSession, recentApplicationExtensionContext, startApplicationExtensionAction, recordApplicationAutofillTelemetry, recordApplicationResumeAttachment, recordAutofillUnresolvedQuestions, updateApplicationAutofillRecovery, updateApplicationExtensionSession } from "../services/application-service.js";
import { MESSAGE_TYPES } from "../shared/messages.js";
import { AutofillPreview } from "./components/AutofillPreview.jsx";
import { AutofillJobsList } from "./components/AutofillJobsList.jsx";
import { autofillValue, autofillValues, guideDefinitions, repeatableSectionRows, screeningDefinitions, sectionResultFields, selectedScreeningAnswersUnchanged } from "../autofill/autofill-context.js";
import { buildAutofillTelemetry, mapAutofillRecovery, mergeAutofillResults } from "../autofill/session-telemetry.js";
import { clearSidepanelView, loadSidepanelView, saveSidepanelView } from "./ui-state.js";

const { Header, Content } = Layout;
const { Text, Title } = Typography;

const TAB_ICONS = {
  capture: <FileSearchOutlined />,
  review: <AuditOutlined />,
  "my-jds": <AuditOutlined />,
  applications: <SolutionOutlined />,
  resumes: <ProfileOutlined />,
  queue: <HistoryOutlined />,
  settings: <SettingOutlined />,
};
const TAB_LABELS = {
  capture: "Capture JD",
  review: "Review JDs",
  "my-jds": "My JDs",
  applications: "My Applications",
  resumes: "Resumes",
  queue: "Tailoring Queue",
  settings: "Settings",
};

const TOAST_TYPES = { success: "success", warning: "warning", error: "error" };

function extensionError(response, fallback) {
  return Object.assign(new Error(response?.error?.message || fallback), { code: response?.error?.code });
}

async function attachSessionResume(sessionId) {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ATTACH_LOADED_RESUME, payload: { sessionId } });
  if (!response?.ok) throw extensionError(response, "The Resume could not be attached.");
  return response.data;
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const SAFE_HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }

// Privacy-safe outcome for the attachment report: status, reason code, adapter, and host names only.
function resumeAttachmentOutcome(sessionData, attachment) {
  const targetDomain = hostOf(sessionData?.targetUrl), frameDomain = String(attachment?.frameDomain || "").toLowerCase(), adapterId = String(attachment?.adapter?.id || "");
  if (!SAFE_HOST.test(targetDomain) || !["ATTACHED", "MANUAL_REQUIRED", "UNSUPPORTED", "FAILED"].includes(attachment?.status)) return null;
  return {
    status: attachment.status,
    code: SAFE_CODE.test(String(attachment.code || "")) ? attachment.code : "RESUME_ATTACHMENT_FAILED",
    targetDomain,
    ...(SAFE_HOST.test(frameDomain) ? { frameDomain } : {}),
    ...(/^[a-z0-9][a-z0-9-]{0,79}$/.test(adapterId) ? { adapterId } : {}),
    embedded: Boolean(attachment.embedded),
  };
}

// Never blocks or fails the Applier's flow; a missing report row is acceptable.
function recordResumeAttachment(client, baseUrl, sessionData, attachment) {
  const outcome = resumeAttachmentOutcome(sessionData, attachment);
  return outcome ? recordApplicationResumeAttachment(client, baseUrl, sessionData.id, outcome).catch(() => {}) : Promise.resolve();
}

// Adds the Application's cover letter text to the Autofill values (kept in memory only).
function withCoverLetter(context, text) {
  if (!context || typeof text !== "string" || !text.trim()) return context;
  return { ...context, values: { ...(context.values || {}), "candidate.coverLetter": text } };
}

function failedAttachment(error) {
  return { status: "FAILED", code: SAFE_CODE.test(String(error?.code || "")) ? error.code : "RESUME_ATTACHMENT_FAILED", message: `The Resume was not attached: ${error?.message || "unknown error"}` };
}

function applicationSessionBanner({ session, context, loadedResume, attachment }) {
  const applicationNumber = context.application.applicationNumber ?? "—";
  const attached = attachment?.status === "ATTACHED";
  const label = session.action === "AUTOFILL" ? "Autofill" : attached ? "Resume Attached" : loadedResume?.ready ? "Resume Ready" : "Attach Resume";
  const description = attached
    ? `${loadedResume?.filename || "The Resume"} was attached and verified for Application #${applicationNumber}. Review the page before continuing; the extension will not submit it.`
    : attachment
      ? attachment.message || "The Resume could not be attached automatically. Retry, or use the job site's file chooser."
      : loadedResume?.ready
        ? `${loadedResume.filename} (${Math.ceil(loadedResume.fileSizeBytes / 1024)} KiB) is held in extension memory. Attach it after reviewing the tracked job page.`
        : `Application #${applicationNumber} is connected.`;
  return {
    type: attached ? "success" : attachment ? "warning" : loadedResume?.ready ? "success" : "info",
    message: `${label}: ${context.job.company} — ${context.job.jobTitle}`,
    description,
  };
}

function availableViews(accessContext) {
  return [
    ...(canReadBusiness(accessContext) ? ["capture"] : []),
    ...(canListOwnJobs(accessContext) ? ["my-jds"] : []),
    ...(canReviewJobs(accessContext) ? ["review"] : []),
    ...(canAccessMyApplications(accessContext) ? ["applications"] : []),
    ...(canAccessResumeQueue(accessContext) ? ["resumes", "queue"] : []),
    "settings",
  ];
}

export function App() {
  const { message: messageApi } = AntdApp.useApp();
  const [currentView, setCurrentView] = useState(null);
  const [config, setConfig] = useState(null);
  const [minimumScore, setMinimumScore] = useState(60);
  const [backendBaseUrl, setBackendBaseUrl] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("");
  const [connecting, setConnecting] = useState(null);
  const connectAbortRef = useRef(null);
  const [connectionText, setConnectionText] = useState("Not configured");
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(null);
  const [access, setAccess] = useState(null);
  const [categories, setCategories] = useState([]);
  const [industryDomains, setIndustryDomains] = useState([]);
  const [status, setStatus] = useState(null);
  const [clearBusy, setClearBusy] = useState(false);
  // One job per tab: several Applications can be autofilling at once. jobsRef holds the latest state for
  // the running async work; `jobs` mirrors it for rendering.
  const [jobs, setJobs] = useState(() => new Map());
  const jobsRef = useRef(new Map());
  const startedJobsRef = useRef(new Set());
  const writeQueuesRef = useRef(new Map());
  const [currentTabId, setCurrentTabId] = useState(null);
  // Attachment results by session id, so a re-scan does not re-upload (ATS parsers would overwrite edited fields).
  const attachmentsRef = useRef(new Map());
  const navRef = useRef(null);
  const mountedViewsRef = useRef(new Set());

  const handleError = useCallback((error) => {
    const safe = safeError(error);
    const detail = safe.retryable ? "" : safe.details;
    setStatus({ message: `${safe.message}${detail ? ` ${detail}` : ""}`, kind: "error" });
  }, []);

  const enterAuthenticated = useCallback(async (activeClient, activeBackendBaseUrl = backendBaseUrl) => {
    const nextSession = await currentSession(activeClient);
    if (!nextSession) {
      setSession(null);
      setCurrentView("auth");
      return;
    }
    setSession(nextSession);
    let accessContext;
    try {
      accessContext = await getMyAccessContext(activeClient, activeBackendBaseUrl);
    } catch (error) {
      setAccess(null);
      setCurrentView("access");
      handleError(error);
      return;
    }
    setAccess(accessContext);
    if (!canReadBusiness(accessContext)) {
      setCurrentView("access");
      setStatus({
        message: extensionAccessMessage(accessContext),
        kind: accessContext.status === "INACTIVE" ? "error" : "warning",
      });
      return;
    }
    const [loadedCategories, loadedIndustryDomains] = await Promise.all([
      listCategories(activeClient, activeBackendBaseUrl),
      listIndustryDomains(activeClient, activeBackendBaseUrl),
    ]);
    setCategories(loadedCategories);
    setIndustryDomains(loadedIndustryDomains);
    const allowedViews = availableViews(accessContext);
    setCurrentView(await loadSidepanelView(nextSession.user.id, allowedViews, "capture"));
    if (!canWriteBusiness(accessContext)) {
      setStatus({ message: extensionAccessMessage(accessContext), kind: "warning" });
    }
  }, [handleError, backendBaseUrl]);

  useEffect(() => {
    if (!status?.message) return;
    const type = TOAST_TYPES[status.kind] || "info";
    messageApi.open({ type, content: status.message, duration: type === "error" ? 6 : 4 });
  }, [status, messageApi]);

  useEffect(() => {
    if (!session?.user?.id || !currentView) return;
    saveSidepanelView(session.user.id, currentView).catch(() => {});
  }, [session?.user?.id, currentView]);

  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    const setNavHeight = () =>
      document.documentElement.style.setProperty("--sidepanel-nav-height", `${node.offsetHeight}px`);
    setNavHeight();
    const observer = new ResizeObserver(setNavHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [session]);

  useEffect(() => {
    (async () => {
      try {
        const stored = await loadConfig();
        setConfig(stored.supabaseConfig);
        setBackendBaseUrl(stored.backendConfig?.baseUrl || "");
        setDashboardUrl(stored.dashboardUrl || "");
        setMinimumScore(Number(stored.matchingSettings.minimumScore ?? 60));
        const check = validateSupabaseConfig(stored.supabaseConfig);
        if (!check.valid) {
          setCurrentView("settings");
          return;
        }
        const nextClient = getSupabaseClient(stored.supabaseConfig);
        setClient(nextClient);
        setConnectionText("Supabase configured");
        await enterAuthenticated(nextClient, stored.backendConfig?.baseUrl || "");
      } catch (error) {
        setCurrentView("settings");
        handleError(error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateJob = useCallback((id, patch) => {
    const previous = jobsRef.current.get(id);
    if (!previous && typeof patch === "function") return;
    const next = { ...(previous || {}), ...(typeof patch === "function" ? patch(previous) : patch) };
    jobsRef.current.set(id, next);
    setJobs(new Map(jobsRef.current));
  }, []);

  // Status, recovery, and telemetry writes for one session run in order in the background, so the page is
  // filled without waiting on them. Failures are ignored: they never block the Applier.
  const backgroundWrite = useCallback((id, task) => {
    const tail = (writeQueuesRef.current.get(id) || Promise.resolve()).then(task).catch(() => {});
    writeQueuesRef.current.set(id, tail);
    return tail;
  }, []);

  // Sent in order per tab, so a late step never paints over the finished status.
  const statusQueuesRef = useRef(new Map());
  const tabStatus = useCallback((id, state, heading = "", detail = "", progress = null) => {
    const payload = { sessionId: id, state, heading, detail, ...(progress ? { step: progress.step, steps: progress.steps } : {}) };
    const tail = (statusQueuesRef.current.get(id) || Promise.resolve()).then(() => chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_APPLICATION_TAB_STATUS, payload })).catch(() => {});
    statusQueuesRef.current.set(id, tail);
  }, []);

  // The centered "Autofilling…" card in the job tab: Loading application → Attaching resume → Reading the form → Filling fields.
  const tabProgress = useCallback((id, step, steps, label) => tabStatus(id, "WORKING", label, "", { step, steps }), [tabStatus]);

  // "12 filled · 2 failed · 3 for you to answer · 1 waiting for this tab"
  const finishSummary = useCallback((id, { results = [], unresolved = [], deferred = [], company = "" }) => {
    const verified = results.filter((result) => result.status === "VERIFIED").length;
    const failed = results.filter((result) => result.status === "FAILED" && !deferred.includes(result.fieldId)).length;
    const parts = [`${verified} filled`, failed ? `${failed} failed` : "", unresolved.length ? `${unresolved.length} for you to answer` : "", deferred.length ? `${deferred.length} waiting for this tab` : ""].filter(Boolean);
    const attention = failed > 0 || deferred.length > 0;
    tabStatus(id, attention ? "ATTENTION" : "DONE", attention ? "Autofill needs your attention" : "Autofill finished", `${parts.join(" · ")}. Review the page before submitting.`);
    return { summary: parts.join(" · "), attention, verified };
  }, [tabStatus]);

  // Search dropdowns (react-select) only open in the tab the Applier is looking at. Fields that did not
  // fill in a background tab are left "waiting" and retried once as soon as the tab comes to the front.
  async function waitingForTab(sessionData, fields, results) {
    const tab = await chrome.tabs.get(sessionData.targetTabId).catch(() => null);
    if (!tab || tab.active) return [];
    const retryable = new Set(fields.filter((field) => field.controlType !== "section").map((field) => field.fieldId));
    return results.filter((result) => result.status !== "VERIFIED" && retryable.has(result.fieldId)).map((result) => result.fieldId);
  }

  const runJob = useCallback(async (sessionData) => {
    if (!client || !backendBaseUrl) return;
    const id = sessionData.id, write = (task) => backgroundWrite(id, task);
    jobsRef.current.set(id, { session: sessionData, phase: "starting", busy: true, startedAt: Date.now(), autofillOverrides: {} });
    setJobs(new Map(jobsRef.current));
    const steps = sessionData.action === "LOAD_RESUME" ? 2 : 4;
    tabProgress(id, 1, steps, "Loading application");
    write(() => updateApplicationExtensionSession(client, backendBaseUrl, id, "TARGET_READY"));
    try {
      const context = recentApplicationExtensionContext(sessionData.applicationId) || await getApplicationExtensionContext(client, backendBaseUrl, sessionData.applicationId);
      updateJob(id, { context });
      const company = context?.job?.company || "";
      let loadedResume = null, attachment = attachmentsRef.current.get(id) || null;
      if (sessionData.action === "LOAD_RESUME") {
        loadedResume = await loadApplicationResumeForSession(client, backendBaseUrl, sessionData);
        if (!attachment) {
          tabProgress(id, 2, steps, "Attaching resume");
          attachment = await attachSessionResume(id);
          attachmentsRef.current.set(id, attachment);
          recordResumeAttachment(client, backendBaseUrl, sessionData, attachment);
          if (attachment.status === "ATTACHED") {
            write(() => updateApplicationExtensionSession(client, backendBaseUrl, id, "COMPLETED"));
            tabStatus(id, "DONE", "Resume attached", `${loadedResume.filename} is attached. Review the page before submitting.`);
            setStatus({ message: `${company ? `${company}: ` : ""}${loadedResume.filename} attached and verified. Review the page before submitting.`, kind: "success" });
          } else {
            tabStatus(id, "ATTENTION", "Attach the Resume yourself", attachment.message || "Use the job site's file chooser.");
            setStatus({ message: attachment.message || "Use the job site's file chooser to attach the Resume manually.", kind: "warning" });
          }
        } else if (attachment.status === "ATTACHED") tabStatus(id, "DONE", "Resume attached", "Review the page before submitting.");
        else tabStatus(id, "ATTENTION", "Attach the Resume yourself", attachment.message || "Use the job site's file chooser.");
        updateJob(id, { phase: "done", busy: false, loadedResume, attachment });
        return;
      }
      // Everything the page needs is requested at once instead of one call after another.
      const [contextResult, priorRecovery, coverLetter, resumeResult] = await Promise.all([
        getApplicationAutofillContext(client, backendBaseUrl, sessionData.applicationId, id),
        getApplicationAutofillRecovery(client, backendBaseUrl, id).catch(() => null),
        // The Application's cover letter fills a "Cover letter" text box.
        getApplicationCoverLetterText(client, backendBaseUrl, sessionData.applicationId).catch(() => null),
        context?.permissions?.canLoadResume
          ? loadApplicationResumeForSession(client, backendBaseUrl, sessionData).then((value) => ({ value }), (error) => ({ error }))
          : Promise.resolve(null),
      ]);
      let autofillContext = contextResult;
      if (coverLetter?.text && autofillContext?.preferences?.allowProfileFields !== false) autofillContext = withCoverLetter(autofillContext, coverLetter.text);
      const recovered = Boolean(priorRecovery && priorRecovery.stepIdentifier !== "NEW");
      const reviewRequired = Boolean(autofillContext?.preferences?.requireReviewEveryField);
      // Attach the Resume before detecting fields: ATS resume parsers (Lever, Workday, …) repopulate fields on upload.
      // A Resume problem never blocks field Autofill; it is reported in the banner with a retry.
      if (resumeResult?.error) {
        attachment = failedAttachment(resumeResult.error);
        recordResumeAttachment(client, backendBaseUrl, sessionData, attachment);
      } else if (resumeResult?.value) {
        loadedResume = resumeResult.value;
        if (!attachment && !recovered && !reviewRequired) {
          tabProgress(id, 2, steps, "Attaching resume");
          try {
            attachment = await attachSessionResume(id);
            attachmentsRef.current.set(id, attachment);
          } catch (error) { attachment = failedAttachment(error); }
          recordResumeAttachment(client, backendBaseUrl, sessionData, attachment);
        }
      }
      updateJob(id, { phase: "scanning", loadedResume, attachment, autofillContext });
      tabProgress(id, 3, steps, "Reading the form");
      const prepared = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PREPARE_PERSONAL_AUTOFILL, payload: { sessionId: id, applicationId: sessionData.applicationId, availableKeys: Object.keys(autofillValues(autofillContext)), applicationAnswers: screeningDefinitions(autofillContext), guideEntries: guideDefinitions(autofillContext) } });
      if (!prepared?.ok) throw Object.assign(new Error(prepared?.error?.message || "The job page could not be inspected for Autofill."), { code: prepared?.error?.code });
      let autofillFields = prepared.data.fields || [];
      const unresolvedAutofillQuestions = prepared.data.unresolved || [];
      const autofillAdapter = prepared.data.adapter || null, autofillTargetDomain = prepared.data.targetDomain || "", autofillTargetOrigin = prepared.data.targetOrigin || sessionData.targetOrigin || "";
      let selectedAutofillFieldIds = autofillFields.map((field) => field.fieldId);
      recordAutofillUnresolvedQuestions(client, backendBaseUrl, id, { targetDomain: autofillTargetDomain, adapterId: autofillAdapter?.id, unresolved: unresolvedAutofillQuestions }).catch(() => {});
      const recoveryPayload = { targetOrigin: prepared.data.targetOrigin, resumeUpdatedAt: autofillContext.resumeUpdatedAt, adapterId: autofillAdapter?.id, adapterVersion: autofillAdapter?.version };
      write(() => updateApplicationAutofillRecovery(client, backendBaseUrl, id, { ...recoveryPayload, stepIdentifier: "DETECTED" }));
      let autofillResults = recovered ? mapAutofillRecovery(autofillFields, priorRecovery.fields) : [];
      let deferredFieldIds = [], outcome = null;
      // Jobs and schools for forms that add them one at a time behind an "Add" button (Workable).
      const sectionRows = repeatableSectionRows(autofillContext, prepared.data.sections), hasSections = Object.values(sectionRows).some((rows) => rows.length);
      if ((autofillFields.length || hasSections) && !recovered && !reviewRequired) {
        updateJob(id, { phase: "filling" });
        tabProgress(id, 4, steps, "Filling fields");
        write(() => updateApplicationAutofillRecovery(client, backendBaseUrl, id, { ...recoveryPayload, stepIdentifier: "FILLING" }));
        const fields = autofillFields.map((field) => ({ fieldId: field.fieldId, key: field.key, answerKey: field.answerKey, answerType: field.answerType, value: autofillValue(autofillContext, field) }));
        const filled = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL, payload: { sessionId: id, applicationId: sessionData.applicationId, adapterId: autofillAdapter?.id || "", fields, sections: sectionRows } });
        if (!filled?.ok) throw Object.assign(new Error(filled?.error?.message || "The detected fields could not be filled."), { code: filled?.error?.code });
        autofillResults = filled.data.results || [];
        const sectionFields = sectionResultFields(autofillResults, sectionRows);
        autofillFields = [...autofillFields, ...sectionFields];
        selectedAutofillFieldIds = [...selectedAutofillFieldIds, ...sectionFields.map((field) => field.fieldId)];
        deferredFieldIds = await waitingForTab(sessionData, autofillFields, autofillResults);
        const verified = autofillResults.filter((result) => result.status === "VERIFIED").length, complete = verified === autofillResults.length;
        write(() => updateApplicationAutofillRecovery(client, backendBaseUrl, id, { ...recoveryPayload, stepIdentifier: complete ? "FILLED" : "PARTIAL" }));
        if (complete) write(() => updateApplicationExtensionSession(client, backendBaseUrl, id, "COMPLETED"));
        outcome = finishSummary(id, { results: autofillResults, unresolved: unresolvedAutofillQuestions, deferred: deferredFieldIds, company });
        setStatus({ message: `${company ? `${company}: ` : ""}${outcome.summary}. Review the page before submitting.`, kind: outcome.attention ? "warning" : "success" });
      } else if (recovered) {
        tabStatus(id, "ATTENTION", "Autofill session recovered", "Retry only the fields that still need work.");
        setStatus({ message: "Autofill session recovered. The page was re-scanned; retry only the fields that still need work.", kind: "warning" });
      } else if (reviewRequired) {
        tabStatus(id, "ATTENTION", "Review before filling", "This Resume requires a preview click before Autofill fills fields.");
        setStatus({ message: "Review is required by this Resume's Autofill preferences. Inspect the detected fields, then choose Fill selected fields.", kind: "warning" });
      } else {
        finishSummary(id, { results: [], unresolved: unresolvedAutofillQuestions, company });
      }
      const telemetry = buildAutofillTelemetry({ resumeUpdatedAt: autofillContext.resumeUpdatedAt, adapter: autofillAdapter, targetDomain: autofillTargetDomain, fields: autofillFields, selectedFieldIds: selectedAutofillFieldIds, results: autofillResults, unresolved: unresolvedAutofillQuestions });
      write(() => recordApplicationAutofillTelemetry(client, backendBaseUrl, id, telemetry));
      updateJob(id, { phase: "done", busy: false, autofillContext, autofillFields, unresolvedAutofillQuestions, autofillAdapter, autofillTargetDomain, autofillTargetOrigin, selectedAutofillFieldIds, autofillResults, deferredFieldIds, summary: outcome?.summary || "", attention: Boolean(outcome?.attention) });
    } catch (error) {
      const safeCode = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : (sessionData.action === "AUTOFILL" ? "AUTOFILL_FAILED" : "RESUME_LOAD_FAILED");
      // Record before the session becomes FAILED, which closes it to further outcome writes.
      if (sessionData.action === "LOAD_RESUME" && !attachmentsRef.current.has(id)) write(() => recordResumeAttachment(client, backendBaseUrl, sessionData, { status: "FAILED", code: safeCode }));
      write(() => updateApplicationExtensionSession(client, backendBaseUrl, id, "FAILED", safeCode));
      const safe = safeError(error);
      tabStatus(id, "FAILED", "Autofill stopped", safe.message);
      updateJob(id, { phase: "failed", busy: false, error: safe.message });
      handleError(error);
    }
  }, [client, backendBaseUrl, handleError, updateJob, backgroundWrite, tabStatus, tabProgress, finishSummary]);

  // Starts a job for every Application session that is running in a tab and not yet handled here.
  const syncJobs = useCallback(async () => {
    if (!client || !session || !backendBaseUrl) return;
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.LIST_APPLICATION_SESSIONS }).catch(() => null);
    const sessions = response?.ok && Array.isArray(response.data) ? response.data : [];
    const live = new Set(sessions.map((item) => item.id));
    let removed = false;
    for (const id of [...jobsRef.current.keys()]) if (!live.has(id)) { jobsRef.current.delete(id); startedJobsRef.current.delete(id); removed = true; }
    if (removed) setJobs(new Map(jobsRef.current));
    for (const item of sessions) {
      if (startedJobsRef.current.has(item.id)) continue;
      startedJobsRef.current.add(item.id);
      setCurrentView("applications");
      runJob(item);
    }
  }, [client, session, backendBaseUrl, runJob]);

  useEffect(() => {
    if (!client || !session) return;
    syncJobs();
    const changed = (changes, area) => { if (area === "session" && changes.applicationSessions) syncJobs(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [client, session, syncJobs]);

  // The panel shows the job for the tab the Applier is looking at.
  useEffect(() => {
    const refresh = () => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => setCurrentTabId(tab?.id ?? null)).catch(() => {});
    const activated = ({ tabId }) => setCurrentTabId(tabId);
    refresh();
    chrome.tabs.onActivated.addListener(activated);
    chrome.windows?.onFocusChanged?.addListener(refresh);
    return () => { chrome.tabs.onActivated.removeListener(activated); chrome.windows?.onFocusChanged?.removeListener(refresh); };
  }, []);

  // The job page's Autofill button asks the panel, through the worker, to start an Application by its id
  // (picked from the list) or its number (typed). The panel starts it exactly as a card click would.
  const startFromPage = useCallback(async ({ applicationId, applicationNumber, tabId }) => {
    const { [PANEL_APPLICATIONS_KEY]: stored } = await chrome.storage.session.get(PANEL_APPLICATIONS_KEY);
    const listed = Array.isArray(stored?.items) ? stored.items : [];
    let item = applicationId ? listed.find((entry) => entry.id === applicationId) : listed.find((entry) => entry.number === applicationNumber);
    if (!item && applicationNumber) {
      const data = await listMyApplications(client, backendBaseUrl, { status: "", limit: 500 });
      item = panelApplicationItems((data.items || []).filter((row) => Number(row.application_number) === applicationNumber))[0];
    }
    if (!item) throw new AppError("APPLICATION_NOT_FOUND", applicationNumber ? `Application #${applicationNumber} is not assigned to you.` : "That Application is not assigned to you.");
    await startApplicationExtensionAction(client, backendBaseUrl, item.id, "AUTOFILL", { targetTabId: tabId });
    setStatus({ message: `Autofill started for Application #${item.number ?? "?"}${item.company ? ` (${item.company})` : ""} from the job page.`, kind: "info" });
    return { number: item.number };
  }, [client, backendBaseUrl]);

  useEffect(() => {
    if (!client || !session || !backendBaseUrl) return;
    let port = null, stopped = false;
    const connect = () => {
      port = chrome.runtime.connect({ name: "sidepanel" });
      chrome.windows.getCurrent().then((win) => port?.postMessage({ type: "PANEL_HELLO", windowId: win.id })).catch(() => {});
      port.onMessage.addListener(async (message) => {
        if (message?.type !== "PAGE_AUTOFILL_REQUEST") return;
        const payload = message.payload || {};
        const request = { applicationId: typeof payload.applicationId === "string" ? payload.applicationId : "", applicationNumber: Number(payload.applicationNumber) || null, tabId: Number.isInteger(payload.tabId) ? payload.tabId : null };
        let result;
        try { result = { ok: true, data: await startFromPage(request) }; }
        catch (error) { const safe = safeError(error); result = { ok: false, error: { code: safe.code, message: safe.message } }; handleError(error); }
        try { port?.postMessage({ type: "PAGE_AUTOFILL_RESULT", requestId: message.requestId, result }); } catch { /* worker restarted */ }
      });
      // The worker can restart at any time; reconnect so the page button keeps working.
      port.onDisconnect.addListener(() => { port = null; if (!stopped) setTimeout(() => { if (!stopped) connect(); }, 500); });
    };
    connect();
    return () => { stopped = true; try { port?.disconnect(); } catch { /* already closed */ } };
  }, [client, session, backendBaseUrl, startFromPage, handleError]);

  async function resetApplicationSession(id) {
    const job = jobsRef.current.get(id);
    if (!job) return;
    attachmentsRef.current.delete(id);
    if (job.phase !== "failed") backgroundWrite(id, () => updateApplicationExtensionSession(client, backendBaseUrl, id, "CANCELLED"));
    jobsRef.current.delete(id);
    startedJobsRef.current.delete(id);
    setJobs(new Map(jobsRef.current));
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_ACTIVE_APPLICATION_SESSION, payload: { sessionId: id } }).catch(() => {});
  }

  function rescanJob(id) {
    const job = jobsRef.current.get(id);
    if (!job?.session || job.busy) return;
    runJob(job.session);
  }

  async function attachActiveResume(id) {
    const active = jobsRef.current.get(id);
    if (!active?.session || active.attachmentBusy) return;
    updateJob(id, { attachmentBusy: true });
    let recorded = false;
    try {
      const latest=await getApplicationExtensionContext(client,backendBaseUrl,active.session.applicationId);
      if(!latest?.permissions?.canLoadResume||latest?.resume?.status!=="ACTIVE")throw Object.assign(new Error("The Resume is no longer eligible for attachment."),{code:"APPLICATION_RESUME_UNAVAILABLE"});
      const loadedResume = active.loadedResume?.ready ? active.loadedResume : await loadApplicationResumeForSession(client, backendBaseUrl, active.session);
      const attachment = await attachSessionResume(id);
      attachmentsRef.current.set(id, attachment);
      recordResumeAttachment(client, backendBaseUrl, active.session, attachment);
      recorded = true;
      updateJob(id, { loadedResume, attachment });
      if (attachment.status === "ATTACHED") {
        if (active.session.action === "LOAD_RESUME") backgroundWrite(id, () => updateApplicationExtensionSession(client, backendBaseUrl, id, "COMPLETED"));
        setStatus({ message: "Resume attached and verified on the tracked job page.", kind: "success" });
      } else if (attachment.status === "MANUAL_REQUIRED" || attachment.status === "UNSUPPORTED") {
        setStatus({ message: attachment.message || "Use the job site's file chooser to attach the Resume manually.", kind: "warning" });
      } else throw new Error(attachment.message || "The Resume attachment could not be verified.");
    } catch (error) {
      if (!recorded) recordResumeAttachment(client, backendBaseUrl, active.session, failedAttachment(error));
      handleError(error);
    } finally {
      updateJob(id, { attachmentBusy: false });
    }
  }

  function changeAutofillSelection(id, fieldId, checked) {
    updateJob(id, (current) => {
      const selected = new Set(current.selectedAutofillFieldIds || []);
      if (checked) selected.add(fieldId); else selected.delete(fieldId);
      return { selectedAutofillFieldIds: [...selected] };
    });
  }

  function changeAutofillValue(id,fieldId,value){updateJob(id,(current)=>({autofillOverrides:{...(current.autofillOverrides||{}),[fieldId]:value}}));}

  // Fills the selected fields that are not yet verified; `onlyFieldIds` limits it to fields that were
  // waiting for their tab to come to the front.
  const fillActiveAutofill = useCallback(async (id, onlyFieldIds = null) => {
    const active = jobsRef.current.get(id);
    if (!active?.autofillContext || active.busy) return;
    const selected = new Set(onlyFieldIds || active.selectedAutofillFieldIds || []);
    if (!selected.size) return;
    // Cleared up front so a failing retry is never repeated on every tab switch.
    updateJob(id, { busy: true, phase: "filling", deferredFieldIds: [] });
    tabProgress(id, 1, 1, "Filling fields");
    try {
      const fresh = await getApplicationAutofillContext(client, backendBaseUrl, active.session.applicationId, id, active.autofillContext.resumeUpdatedAt);
      const current = withCoverLetter(fresh, active.autofillContext?.values?.["candidate.coverLetter"]);
      const completed=new Set((active.autofillResults||[]).filter(result=>result.status==="VERIFIED").map(result=>result.fieldId));
      // Added job/school entries are never re-added on retry; a person fixes those on the page.
      const selectedFields = active.autofillFields.filter((field) => selected.has(field.fieldId)&&!completed.has(field.fieldId)&&field.controlType!=="section");
      if(!selectedFields.length){finishSummary(id,{results:active.autofillResults||[],unresolved:active.unresolvedAutofillQuestions||[]});updateJob(id,{busy:false,phase:"done"});return;}
      if (!selectedScreeningAnswersUnchanged(active.autofillContext, current, selectedFields)) throw Object.assign(new Error("An approved screening answer changed after this preview. Start Autofill again."), { code: "AUTOFILL_CONTEXT_STALE" });
      const fields = selectedFields.map((field) => ({ fieldId: field.fieldId, key: field.key, answerKey: field.answerKey, answerType: field.answerType, value: Object.hasOwn(active.autofillOverrides||{},field.fieldId)?active.autofillOverrides[field.fieldId]:autofillValue(current, field) }));
      const recoveryPayload={targetOrigin:active.autofillTargetOrigin||new URL(active.session.targetUrl).origin,resumeUpdatedAt:current.resumeUpdatedAt,adapterId:active.autofillAdapter?.id,adapterVersion:active.autofillAdapter?.version};
      backgroundWrite(id, () => updateApplicationAutofillRecovery(client,backendBaseUrl,id,{...recoveryPayload,stepIdentifier:"FILLING"}));
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL, payload: { sessionId: id, applicationId: active.session.applicationId, adapterId:active.autofillAdapter?.id||"", fields } });
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || "The selected fields could not be filled."), { code: response?.error?.code });
      const results = mergeAutofillResults(active.autofillResults || [], response.data.results || []), verified = results.filter((result) => result.status === "VERIFIED").length;
      const deferredFieldIds = await waitingForTab(active.session, active.autofillFields, results);
      const telemetry=buildAutofillTelemetry({resumeUpdatedAt:current.resumeUpdatedAt,adapter:response.data.adapter||active.autofillAdapter,targetDomain:active.autofillTargetDomain,fields:active.autofillFields,selectedFieldIds:active.selectedAutofillFieldIds,results,unresolved:active.unresolvedAutofillQuestions});
      const complete = results.length && verified === results.length;
      backgroundWrite(id, () => recordApplicationAutofillTelemetry(client,backendBaseUrl,id,telemetry));
      backgroundWrite(id, () => updateApplicationAutofillRecovery(client,backendBaseUrl,id,{...recoveryPayload,stepIdentifier:complete?"FILLED":"PARTIAL"}));
      if (complete) backgroundWrite(id, () => updateApplicationExtensionSession(client, backendBaseUrl, id, "COMPLETED"));
      const outcome = finishSummary(id, { results, unresolved: active.unresolvedAutofillQuestions || [], deferred: deferredFieldIds, company: active.context?.job?.company });
      updateJob(id, { autofillResults: results, deferredFieldIds, summary: outcome.summary, attention: outcome.attention });
      setStatus({ message: `${active.context?.job?.company ? `${active.context.job.company}: ` : ""}${outcome.summary}. Review the page before submitting.`, kind: outcome.attention ? "warning" : "success" });
    } catch (error) { tabStatus(id, "FAILED", "Autofill stopped", safeError(error).message); handleError(error); }
    finally { updateJob(id, { busy: false, phase: "done" }); }
  }, [client, backendBaseUrl, handleError, updateJob, backgroundWrite, tabStatus, tabProgress, finishSummary]);

  // Finish dropdowns that were waiting for their tab as soon as the Applier switches to it.
  useEffect(() => {
    if (currentTabId === null) return;
    for (const [id, job] of jobs) {
      if (job.session?.targetTabId === currentTabId && job.deferredFieldIds?.length && !job.busy) fillActiveAutofill(id, job.deferredFieldIds);
    }
  }, [currentTabId, jobs, fillActiveAutofill]);

  async function handleSaveSettings(normalizedConfig, normalizedBackendBaseUrl, score) {
    try {
      if (config?.projectUrl && config.projectUrl !== normalizedConfig.projectUrl) await clearLookupCaches();
      await chrome.storage.local.set({
        supabaseConfig: normalizedConfig,
        backendConfig: { baseUrl: normalizedBackendBaseUrl },
        matchingSettings: { minimumScore: score },
      });
      setConfig(normalizedConfig);
      setBackendBaseUrl(normalizedBackendBaseUrl);
      setMinimumScore(score);
      const nextClient = getSupabaseClient(normalizedConfig);
      setClient(nextClient);
      setConnectionText("Supabase configured");
      setStatus({ message: "Settings successfully saved.", kind: "success" });
    } catch (error) {
      const safe = safeError(error);
      setStatus({ message: `Failed to save settings. ${safe.message}`, kind: "error" });
    }
  }

  function handleConnectionResult({ connection, message, kind }) {
    if (connection) setConnectionText(connection);
    setStatus({ message, kind: kind || "success" });
  }

  async function handleSignIn(email, password) {
    try {
      await signIn(client, email, password);
      await recordLogin(client, backendBaseUrl, "EXTENSION");
      await enterAuthenticated(client);
      setStatus({ message: "Signed in successfully.", kind: "success" });
    } catch (error) {
      handleError(error);
    }
  }

  // Sign in by approving this extension from an already signed-in dashboard tab.
  async function handleConnect() {
    const controller = new AbortController();
    connectAbortRef.current = controller;
    try {
      const pairing = await createPairing();
      setConnecting({ code: pairing.code });
      await chrome.tabs.create({ url: pairingUrl(dashboardUrl, pairing) });
      const granted = await waitForApproval(backendBaseUrl, pairing, { signal: controller.signal });
      const { error } = await client.auth.setSession({ access_token: granted.accessToken, refresh_token: granted.refreshToken });
      if (error) throw error;
      await enterAuthenticated(client);
      setStatus({ message: "Connected to the dashboard and signed in.", kind: "success" });
    } catch (error) {
      if (error?.code !== "EXTENSION_CONNECT_CANCELLED") handleError(error);
    } finally {
      if (connectAbortRef.current === controller) connectAbortRef.current = null;
      setConnecting(null);
    }
  }

  function handleCancelConnect() {
    connectAbortRef.current?.abort();
    setConnecting(null);
  }

  async function handleSignOut() {
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_ACTIVE_APPLICATION_SESSION }).catch(() => {});
      // Job pages stop offering this Applier's Applications.
      await chrome.storage.session.remove(PANEL_APPLICATIONS_KEY).catch(() => {});
      await clearSidepanelView(session?.user?.id).catch(() => {});
      await signOut(client);
    } finally {
      mountedViewsRef.current.clear();
      setSession(null);
      setAccess(null);
      setCurrentView("auth");
    }
  }

  async function handleClearSession() {
    setClearBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_ACTIVE_APPLICATION_SESSION }).catch(() => {});
      if (client) await signOut(client).catch(() => {});
      const all = await chrome.storage.local.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith("supabase-auth:")) await chrome.storage.local.remove(key);
      }
      setSession(null);
      setAccess(null);
      setStatus({ message: "Supabase session cleared.", kind: "success" });
      setCurrentView("auth");
    } finally {
      setClearBusy(false);
    }
  }

  if (currentView === null) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
        <Spin size="large" />
      </Flex>
    );
  }

  const visibleTabs = availableViews(access).map((key) => ({ key, label: TAB_LABELS[key], icon: TAB_ICONS[key] }));

  const views = {
    settings: (
      <SettingsView
        config={config}
        backendBaseUrl={backendBaseUrl}
        minimumScore={minimumScore}
        connectionStatus={connectionText}
        onSave={handleSaveSettings}
        onConnectionResult={handleConnectionResult}
        onContinueToSignIn={() => setCurrentView("auth")}
        onClearSession={handleClearSession}
        clearBusy={clearBusy}
      />
    ),
    auth: <AuthView onSignIn={handleSignIn} onConnect={handleConnect} onCancelConnect={handleCancelConnect} connecting={connecting} />,
    access: <AccessView access={access} />,
    capture: (
      <CaptureView
        client={client}
        backendBaseUrl={backendBaseUrl}
        userId={session?.user?.id}
        categories={categories}
        industryDomains={industryDomains}
        minimumScore={minimumScore}
        canWrite={canWriteBusiness(access)}
        canCheckDuplicates={canCheckJobDuplicates(access)}
        canCreateTailoring={canCreateTailoring(access)}
        onStatus={setStatus}
        onError={handleError}
      />
    ),
    review: <JobReviewView client={client} backendBaseUrl={backendBaseUrl} onStatus={setStatus} onError={handleError} />,
    "my-jds": <MyJobDescriptionsView client={client} backendBaseUrl={backendBaseUrl} categories={categories} onStatus={setStatus} onError={handleError} />,
    applications: <MyApplicationsView client={client} backendBaseUrl={backendBaseUrl} onStatus={setStatus} onError={handleError} />,
    resumes: (
      <ResumesView
        client={client}
        backendBaseUrl={backendBaseUrl}
        userId={session?.user?.id}
        categories={categories}
        canWrite={canWriteBusiness(access)}
        onStatus={setStatus}
        onError={handleError}
      />
    ),
    queue: <QueueView client={client} backendBaseUrl={backendBaseUrl} onError={handleError} />,
  };

  if (session) mountedViewsRef.current.add(currentView);
  const renderedViewKeys = session ? [...mountedViewsRef.current] : [currentView];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header className="sidepanel-header">
        <div>
          <Title level={5} style={{ margin: 0, color: "#fff" }}>
            Resume JD Capture
          </Title>
          <Text style={{ color: "#c9d6e8", fontSize: 12 }}>
            v{chrome.runtime.getManifest().version}
          </Text>
        </div>
        <Space orientation="vertical" size={0} align="end">
          <Text style={{ color: "#fff", fontSize: 12 }}>{connectionText}</Text>
          {session && (
            <Space size="small">
              <Text style={{ color: "#c9d6e8", fontSize: 12 }}>{session.user.email}</Text>
              <Button
                size="small"
                type="text"
                icon={<LogoutOutlined />}
                className="sidepanel-header-signout"
                onClick={handleSignOut}
              >
                Sign Out
              </Button>
            </Space>
          )}
        </Space>
      </Header>
      {session && (
        <div className="sidepanel-nav" ref={navRef}>
          <Tabs activeKey={currentView} onChange={setCurrentView} items={visibleTabs} />
        </div>
      )}
      <Content className="sidepanel-content">
        {(() => {
          // The panel follows the tab the Applier is looking at; jobs in other tabs keep running and are listed below it.
          const all = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
          const activeApplicationSession = all.filter((job) => job.session?.targetTabId === currentTabId).at(-1) || null;
          const others = all.filter((job) => job !== activeApplicationSession);
          const id = activeApplicationSession?.session?.id;
          const canAttach = activeApplicationSession && (activeApplicationSession.loadedResume?.ready || activeApplicationSession.attachment) && activeApplicationSession.attachment?.status !== "ATTACHED";
          const banner = activeApplicationSession?.context ? applicationSessionBanner(activeApplicationSession) : null;
          return <>
            {activeApplicationSession && !banner && <Alert type={activeApplicationSession.phase === "failed" ? "error" : "info"} showIcon closable onClose={() => resetApplicationSession(id)} message={activeApplicationSession.phase === "failed" ? "Autofill stopped" : "Autofill is starting on this tab…"} description={activeApplicationSession.error} style={{ marginBottom: 12 }} />}
            {banner && <Alert type={activeApplicationSession.phase === "failed" ? "error" : banner.type} showIcon closable onClose={() => resetApplicationSession(id)} message={banner.message} description={activeApplicationSession.busy ? `${activeApplicationSession.phase === "filling" ? "Filling" : "Scanning"} the page…` : activeApplicationSession.error || [activeApplicationSession.summary, banner.description].filter(Boolean).join(" · ")} action={canAttach ? <Button size="small" loading={Boolean(activeApplicationSession.attachmentBusy)} onClick={() => attachActiveResume(id)}>{activeApplicationSession.attachment ? "Retry Attachment" : "Attach Resume to Page"}</Button> : null} style={{ marginBottom: 12 }} />}
            {activeApplicationSession?.session?.action === "AUTOFILL" && activeApplicationSession.autofillFields && <AutofillPreview active={activeApplicationSession} busy={Boolean(activeApplicationSession.busy)} onSelectionChange={(fieldId, checked) => changeAutofillSelection(id, fieldId, checked)} onValueChange={(fieldId, value) => changeAutofillValue(id, fieldId, value)} onFill={() => fillActiveAutofill(id)} onRescan={() => rescanJob(id)} />}
            <AutofillJobsList jobs={others} onOpen={(job) => { chrome.tabs.update(job.session.targetTabId, { active: true }).catch(() => {}); }} onDismiss={(job) => resetApplicationSession(job.session.id)} />
          </>;
        })()}
        {renderedViewKeys.map((key) => (
          <div key={key} hidden={key !== currentView}>
            {views[key]}
          </div>
        ))}
      </Content>
    </Layout>
  );
}
