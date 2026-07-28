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
import { getApplicationExtensionContext, updateApplicationExtensionSession } from "../services/application-service.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

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
    setCurrentView("capture");
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
      setActiveApplicationSession({ session: response.data, context });
      setCurrentView("applications");
    } catch (error) {
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

  const visibleTabs = [
    ...(canReadBusiness(access) ? ["capture"] : []),
    ...(canAccessMyApplications(access) ? ["applications"] : []),
    ...(canAccessResumeQueue(access) ? ["resumes", "queue"] : []),
    "settings",
  ].map((key) => ({ key, label: TAB_LABELS[key], icon: TAB_ICONS[key] }));

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
        {activeApplicationSession && <Alert type="info" showIcon closable onClose={resetApplicationSession} message={`${activeApplicationSession.session.action === "LOAD_RESUME" ? "Load Resume" : "Autofill"}: ${activeApplicationSession.context.job.company} â€” ${activeApplicationSession.context.job.jobTitle}`} description={`Application #${activeApplicationSession.context.application.applicationNumber ?? "â€”"} is connected. Resume bytes are not downloaded in v0.8.5.`} style={{ marginBottom: 12 }} />}
        {renderedViewKeys.map((key) => (
          <div key={key} hidden={key !== currentView}>
            {views[key]}
          </div>
        ))}
      </Content>
    </Layout>
  );
}
