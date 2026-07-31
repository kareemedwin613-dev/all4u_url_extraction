import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App as AntdApp, Button, Flex, Layout, Space, Spin, Tabs, Typography } from "antd";
import {
  FileSearchOutlined,
  HistoryOutlined,
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
import {
  canAccessMyApplications,
  canAccessResumeQueue,
  canReadBusiness,
  canWriteBusiness,
  extensionAccessMessage,
} from "../access/capabilities.js";
import { listCategories } from "../services/category-service.js";
import { listIndustryDomains } from "../services/industry-domain-service.js";
import { safeError } from "../shared/errors.js";
import { SettingsView } from "./views/SettingsView.jsx";
import { AuthView } from "./views/AuthView.jsx";
import { AccessView } from "./views/AccessView.jsx";
import { CaptureView } from "./views/CaptureView.jsx";
import { MyApplicationsView } from "./views/MyApplicationsView.jsx";
import { ResumesView } from "./views/ResumesView.jsx";
import { QueueView } from "./views/QueueView.jsx";
import { getApplicationAutofillContext, getApplicationExtensionContext, updateApplicationExtensionSession } from "../services/application-service.js";
import { MESSAGE_TYPES } from "../shared/messages.js";
import { AutofillPreview } from "./components/AutofillPreview.jsx";
import { autofillValue, screeningDefinitions, selectedScreeningAnswersUnchanged } from "../autofill/autofill-context.js";
import { clearSidepanelView, loadSidepanelView, saveSidepanelView } from "./ui-state.js";

const { Header, Content } = Layout;
const { Text, Title } = Typography;

const TAB_ICONS = {
  capture: <FileSearchOutlined />,
  applications: <SolutionOutlined />,
  resumes: <ProfileOutlined />,
  queue: <HistoryOutlined />,
  settings: <SettingOutlined />,
};
const TAB_LABELS = {
  capture: "Capture JD",
  applications: "My Applications",
  resumes: "Resumes",
  queue: "Tailoring Queue",
  settings: "Settings",
};

const TOAST_TYPES = { success: "success", warning: "warning", error: "error" };

function availableViews(accessContext) {
  return [
    ...(canReadBusiness(accessContext) ? ["capture"] : []),
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
  const [connectionText, setConnectionText] = useState("Not configured");
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(null);
  const [access, setAccess] = useState(null);
  const [categories, setCategories] = useState([]);
  const [industryDomains, setIndustryDomains] = useState([]);
  const [status, setStatus] = useState(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [activeApplicationSession, setActiveApplicationSession] = useState(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const navRef = useRef(null);
  const mountedViewsRef = useRef(new Set());

  const handleError = useCallback((error) => {
    const safe = safeError(error);
    setStatus({ message: `${safe.message}${safe.details ? ` ${safe.details}` : ""}`, kind: "error" });
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

  const loadApplicationSession = useCallback(async () => {
    if (!client || !session || !backendBaseUrl) return;
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_ACTIVE_APPLICATION_SESSION });
    if (!response?.ok || !response.data) {
      setActiveApplicationSession(null);
      return;
    }
    try {
      const context = await getApplicationExtensionContext(client, backendBaseUrl, response.data.applicationId);
      await updateApplicationExtensionSession(client, backendBaseUrl, response.data.id, "TARGET_READY");
      let loadedResume = null;
      if (response.data.action === "LOAD_RESUME") {
        const loaded = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.LOAD_APPLICATION_RESUME,
          payload: {
            sessionId: response.data.id,
            applicationId: response.data.applicationId,
            baseUrl: backendBaseUrl,
            accessToken: session.access_token,
          },
        });
        if (!loaded?.ok) throw new Error(loaded?.error?.message || "The private Resume could not be loaded.");
        loadedResume = loaded.data;
      }
      let autofillContext = null, autofillFields = [], unresolvedAutofillQuestions=[], autofillAdapter=null, selectedAutofillFieldIds = [], autofillResults = [];
      if (response.data.action === "AUTOFILL") {
        autofillContext = await getApplicationAutofillContext(client, backendBaseUrl, response.data.applicationId, response.data.id);
        const prepared = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PREPARE_PERSONAL_AUTOFILL, payload: { sessionId: response.data.id, applicationId: response.data.applicationId, availableKeys: Object.keys(autofillContext.values || {}), applicationAnswers: screeningDefinitions(autofillContext) } });
        if (!prepared?.ok) throw Object.assign(new Error(prepared?.error?.message || "The job page could not be inspected for Autofill."), { code: prepared?.error?.code });
        autofillFields = prepared.data.fields || [];
        unresolvedAutofillQuestions=prepared.data.unresolved||[];
        autofillAdapter=prepared.data.adapter||null;
        selectedAutofillFieldIds = autofillFields.map((field) => field.fieldId);
        if (autofillFields.length) {
          const fields=autofillFields.map(field=>({fieldId:field.fieldId,key:field.key,answerKey:field.answerKey,answerType:field.answerType,value:autofillValue(autofillContext,field)}));
          const filled=await chrome.runtime.sendMessage({type:MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL,payload:{sessionId:response.data.id,applicationId:response.data.applicationId,adapterId:autofillAdapter?.id||"",fields}});
          if(!filled?.ok)throw Object.assign(new Error(filled?.error?.message||"The detected fields could not be filled."),{code:filled?.error?.code});
          autofillResults=filled.data.results||[];
          const verified=autofillResults.filter(result=>result.status==="VERIFIED").length;
          if(verified===autofillResults.length){await updateApplicationExtensionSession(client,backendBaseUrl,response.data.id,"COMPLETED");setStatus({message:`${verified} field${verified===1?"":"s"} filled and verified. Review the page before submitting.`,kind:"success"});}
          else setStatus({message:`${verified} of ${autofillResults.length} detected fields were verified. Complete failed or unsupported fields manually.`,kind:"warning"});
        }
      }
      setActiveApplicationSession({ session: response.data, context, loadedResume, autofillContext, autofillFields, unresolvedAutofillQuestions, autofillAdapter, selectedAutofillFieldIds, autofillResults, autofillOverrides: {} });
      setCurrentView("applications");
    } catch (error) {
      await updateApplicationExtensionSession(client, backendBaseUrl, response.data.id, "FAILED", response.data.action === "AUTOFILL" ? "AUTOFILL_FAILED" : "RESUME_LOAD_FAILED").catch(() => {});
      setActiveApplicationSession(null);
      handleError(error);
    }
  }, [client, session, backendBaseUrl, handleError]);

  useEffect(() => {
    if (!client || !session) return;
    loadApplicationSession();
    const changed = (changes, area) => { if (area === "session" && changes.activeApplicationSession) loadApplicationSession(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [client, session, loadApplicationSession]);

  async function resetApplicationSession() {
    const id = activeApplicationSession?.session?.id;
    if (id) await updateApplicationExtensionSession(client, backendBaseUrl, id, "CANCELLED").catch(() => {});
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_ACTIVE_APPLICATION_SESSION });
    setActiveApplicationSession(null);
  }

  async function attachActiveResume() {
    const active = activeApplicationSession;
    if (!active?.loadedResume?.ready || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ATTACH_LOADED_RESUME, payload: { sessionId: active.session.id } });
      if (!response?.ok) throw new Error(response?.error?.message || "The Resume could not be attached.");
      const attachment = response.data;
      setActiveApplicationSession((current) => current ? { ...current, attachment } : current);
      if (attachment.status === "ATTACHED") {
        await updateApplicationExtensionSession(client, backendBaseUrl, active.session.id, "COMPLETED");
        setStatus({ message: "Resume attached and verified on the tracked job page.", kind: "success" });
      } else if (attachment.status === "MANUAL_REQUIRED" || attachment.status === "UNSUPPORTED") {
        setStatus({ message: attachment.message || "Use the job site's file chooser to attach the Resume manually.", kind: "warning" });
      } else throw new Error(attachment.message || "The Resume attachment could not be verified.");
    } catch (error) {
      handleError(error);
    } finally {
      setAttachmentBusy(false);
    }
  }

  function changeAutofillSelection(fieldId, checked) {
    setActiveApplicationSession((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedAutofillFieldIds || []);
      if (checked) selected.add(fieldId); else selected.delete(fieldId);
      return { ...current, selectedAutofillFieldIds: [...selected] };
    });
  }

  function changeAutofillValue(fieldId,value){setActiveApplicationSession(current=>current?{...current,autofillOverrides:{...(current.autofillOverrides||{}),[fieldId]:value}}:current);}

  async function fillActiveAutofill() {
    const active = activeApplicationSession;
    if (!active?.autofillContext || autofillBusy) return;
    const selected = new Set(active.selectedAutofillFieldIds || []);
    if (!selected.size) return;
    setAutofillBusy(true);
    try {
      const current = await getApplicationAutofillContext(client, backendBaseUrl, active.session.applicationId, active.session.id, active.autofillContext.resumeUpdatedAt);
      const completed=new Set((active.autofillResults||[]).filter(result=>result.status==="VERIFIED").map(result=>result.fieldId));
      const selectedFields = active.autofillFields.filter((field) => selected.has(field.fieldId)&&!completed.has(field.fieldId));
      if(!selectedFields.length)return;
      if (!selectedScreeningAnswersUnchanged(active.autofillContext, current, selectedFields)) throw Object.assign(new Error("An approved screening answer changed after this preview. Start Autofill again."), { code: "AUTOFILL_CONTEXT_STALE" });
      const fields = selectedFields.map((field) => ({ fieldId: field.fieldId, key: field.key, answerKey: field.answerKey, answerType: field.answerType, value: Object.hasOwn(active.autofillOverrides||{},field.fieldId)?active.autofillOverrides[field.fieldId]:autofillValue(current, field) }));
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL, payload: { sessionId: active.session.id, applicationId: active.session.applicationId, adapterId:active.autofillAdapter?.id||"", fields } });
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || "The selected fields could not be filled."), { code: response?.error?.code });
      const results = response.data.results || [], verified = results.filter((result) => result.status === "VERIFIED").length;
      setActiveApplicationSession((previous) => previous ? { ...previous, autofillResults: results } : previous);
      if (results.length && verified === results.length) {
        await updateApplicationExtensionSession(client, backendBaseUrl, active.session.id, "COMPLETED");
        setStatus({ message: `${verified} field${verified === 1 ? "" : "s"} filled and verified. Review the page before submitting.`, kind: "success" });
      } else setStatus({ message: `${verified} of ${results.length} selected fields were verified. Review failed fields before continuing.`, kind: "warning" });
    } catch (error) { handleError(error); }
    finally { setAutofillBusy(false); }
  }

  async function handleSaveSettings(normalizedConfig, normalizedBackendBaseUrl, score) {
    try {
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
      await enterAuthenticated(client);
      setStatus({ message: "Signed in successfully.", kind: "success" });
    } catch (error) {
      handleError(error);
    }
  }

  async function handleSignOut() {
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_ACTIVE_APPLICATION_SESSION }).catch(() => {});
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
    auth: <AuthView onSignIn={handleSignIn} />,
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
        onStatus={setStatus}
        onError={handleError}
      />
    ),
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
        {activeApplicationSession && <Alert type={activeApplicationSession.attachment?.status === "ATTACHED" ? "success" : activeApplicationSession.attachment?.status === "MANUAL_REQUIRED" || activeApplicationSession.attachment?.status === "UNSUPPORTED" ? "warning" : activeApplicationSession.loadedResume?.ready ? "success" : "info"} showIcon closable onClose={resetApplicationSession} message={`${activeApplicationSession.attachment?.status === "ATTACHED" ? "Resume Attached" : activeApplicationSession.loadedResume?.ready ? "Resume Ready" : activeApplicationSession.session.action === "LOAD_RESUME" ? "Load Resume" : "Autofill"}: ${activeApplicationSession.context.job.company} — ${activeApplicationSession.context.job.jobTitle}`} description={activeApplicationSession.attachment?.status === "ATTACHED" ? `The standard file input was updated and verified for Application #${activeApplicationSession.context.application.applicationNumber ?? "—"}. Review the page before continuing; the extension will not submit it.` : activeApplicationSession.attachment?.message || (activeApplicationSession.loadedResume?.ready ? `${activeApplicationSession.loadedResume.filename} (${Math.ceil(activeApplicationSession.loadedResume.fileSizeBytes / 1024)} KiB) is held in extension memory. Attach it only after reviewing the tracked job page.` : `Application #${activeApplicationSession.context.application.applicationNumber ?? "—"} is connected.`)} action={activeApplicationSession.loadedResume?.ready && activeApplicationSession.attachment?.status !== "ATTACHED" ? <Button size="small" loading={attachmentBusy} onClick={attachActiveResume}>{activeApplicationSession.attachment ? "Retry Attachment" : "Attach Resume to Page"}</Button> : null} style={{ marginBottom: 12 }} />}
        {activeApplicationSession?.session?.action === "AUTOFILL" && activeApplicationSession.autofillContext && <AutofillPreview active={activeApplicationSession} busy={autofillBusy} onSelectionChange={changeAutofillSelection} onValueChange={changeAutofillValue} onFill={fillActiveAutofill} />}
        {renderedViewKeys.map((key) => (
          <div key={key} hidden={key !== currentView}>
            {views[key]}
          </div>
        ))}
      </Content>
    </Layout>
  );
}
