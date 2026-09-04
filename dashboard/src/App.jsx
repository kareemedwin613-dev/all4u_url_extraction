import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table as AntTable,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  BarsOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  HomeOutlined,
  LinkOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  PushpinFilled,
  PushpinOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { parseRoute } from "./router.js";
import { getSession, requestPasswordReset, signIn, signOut, signUp, updatePassword } from "./services/auth-service.js";
import { recordLogin } from "./services/session-events-service.js";
import { authStateDecision } from "./services/auth-state.js";
import { categoryName, formatResumeTechStacks, loadCategories, resumeTechStackRows } from "./services/category-service.js";
import { getJob, listJobCapturers, listJobs, bulkDeleteJobs, bulkReviewJobs, reviewJob, setJobStatus, updateManagedJob, updateOwnJob } from "./services/job-read-service.js";
import { exportFilteredJobsExcel } from "./services/job-export-service.js";
import { getResume, listResumes, setResumeStatus } from "./services/resume-read-service.js";
import { updateResumeMetadata } from "./services/resume-metadata-service.js";
import {
  addResumeBannedCompany,
  listResumeBannedCompanies,
  removeResumeBannedCompany,
} from "./services/resume-banned-companies-service.js";
import { getBusinessOverview } from "./services/business-overview-service.js";
import { ApplierProductivityPage } from "./features/overview/applier-productivity-page.jsx";
import { OverviewDateFilter } from "./features/overview/overview-date-filter.jsx";
import { DEFAULT_OVERVIEW_WINDOW, overviewDateBounds } from "./features/overview/overview-date.js";
import {
  BusinessRecordCards,
} from "./features/overview/overview-count-cards.jsx";
import { getApplicationCounts, getApplierProfileWorkload } from "./features/applications/application-service.js";
import { isApplicationManager } from "./features/applications/validation.js";
import { ApplierProfileWorkloadPage } from "./features/overview/applier-profile-workload-page.jsx";
import { createCoverLetterSignedUrl, createResumeSignedUrl, removeResumeCoverLetter, uploadResumeCoverLetter } from "./services/storage-read-service.js";
import {
  getMyAccessContext,
  listSystemRoles,
} from "./services/access-service.js";
import { CAPABILITIES, hasCapability } from "./access/capabilities.js";
import {
  guardAccessRoute,
  NAVIGATION,
  navigationForAccess,
} from "./access/route-access.js";
import {
  formatBytes,
  formatDate,
  formatLabel,
  formatMime,
  cleanTags,
} from "./shared/formatters.js";
import { isEmailLike, personDisplayName } from "./shared/person-name.js";
import {
  parseJobQuery,
  parseResumeQuery,
  serializeQuery,
} from "./shared/query-state.js";
import { normalizeSearch, validateLogin, validateNewPassword, validatePasswordResetRequest, validateSignUp } from "./shared/validation.js";
import { openExternalUrls, safeExternalUrl } from "./shared/url.js";
import {
  JOB_PAGE_SIZES,
  MIME_TYPES,
  PAGE_SIZES,
  SENIORITIES,
} from "./shared/constants.js";
import {
  serverSortColumns,
  serverSortFromTable,
} from "./shared/table-sorting.js";
import { useTableBodyHeight } from "./shared/use-table-body-height.js";
import { toastFromApp } from "./shared/notifications.js";
import {
  AccessDeniedPage,
  AccessLoadErrorPage,
  InactiveAccountPage,
  PendingAccessPage,
  ProfilePage,
  TechnicalOverview,
} from "./pages/access-pages.jsx";
import {
  AdminRolesPage,
  AdminUserDetailPage,
  AdminUsersPage,
} from "./pages/admin-pages.jsx";
import { UserAvatar } from "./components/user-avatar.jsx";
import { ApplierDetailPage } from "./features/appliers/applier-detail-page.jsx";
import {
  ApplicationDetailPage,
  ApplicationsPage,
  CreateApplicationPage,
} from "./features/applications/application-pages.jsx";
import {
  ApplicationBatchDetailPage,
  ApplicationBatchesPage,
  BulkCreatePage,
} from "./features/bulk-applications/bulk-pages.jsx";
import { MAX_BULK_JDS, MAX_OPEN_JOB_URLS } from "./features/bulk-applications/bulk-state.js";
import { ApplierDirectoryPage } from "./features/applications/applier-directory-page.jsx";
import { AdminResumeUploadPage } from "./features/resume-upload/resume-upload-page.jsx";
import { ApplierWorkloadsPage, AssignmentBatchDetailPage, AssignmentBatchesPage, BulkAssignmentWizardPage } from "./features/bulk-assignment/bulk-assignment-pages.jsx";
import { StructuredResumeView } from "./features/resume-upload/structured-resume-view.jsx";
import { CandidateProfilePage } from "./features/candidates/candidate-profile-page.jsx";
import { ResumeAnswerLibrary } from "./features/resume-answers/resume-answer-library.jsx";
import { TailoringQueuePage, TailoringReviewPage } from "./features/tailoring/tailoring-pages.jsx";
import { TailoringBatchDetailPage, TailoringBatchesPage } from "./features/tailoring/tailoring-batch-pages.jsx";
import {
  DataPagination,
  EllipsisCell,
  EmptyState,
  ErrorState as UiErrorState,
  LegacyTable,
  LoadingState,
  MetaTag,
  Metadata,
  SeniorityTag,
  StatusTag,
  TabbedSections,
  TagList,
  categoryTagColor,
} from "./components/ui.jsx";

const go = (hash, replace = false) =>
  replace ? location.replace(hash) : location.assign(hash);
const { Content, Header, Sider } = Layout,
  { Text, Title } = Typography;
const Loading = LoadingState,
  ErrorState = UiErrorState;
const Badge = StatusTag;
const Tags = ({ values, empty }) => (
  <TagList values={cleanTags(values)} empty={empty} />
);
const Meta = Metadata;
const capturedBy = (job) =>
  personDisplayName({
    displayName: job?.captured_by?.display_name,
    email: job?.captured_by?.email,
    userId: job?.user_id,
  });
const salaryRange = (job) => {
  if (job?.salary_min == null && job?.salary_max == null)
    return job?.salary_text || "Not specified";
  const currency = job.salary_currency || "",
    amount = (value) =>
      value == null
        ? ""
        : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
            Number(value),
          ),
    range =
      job.salary_min === job.salary_max
        ? amount(job.salary_min)
        : `${amount(job.salary_min)} – ${amount(job.salary_max)}`;
  return `${currency} ${range}${job.salary_period ? ` per ${formatLabel(job.salary_period).toLowerCase()}` : ""}`.trim();
};
const Table = LegacyTable,
  Empty = EmptyState;

const Pagination = DataPagination;

const NAV_ICONS = Object.freeze({
    overview: <HomeOutlined />,
    applications: <AppstoreOutlined />,
    "application-batches": <HistoryOutlined />,
    "assignment-batches": <HistoryOutlined />,
    "applier-workloads": <UserOutlined />,
    "applier-directory": <UserOutlined />,
    "applier-detail": <UserOutlined />,
    "tailoring-jobs": <FileSearchOutlined />,
    "tailoring-batches": <HistoryOutlined />,
    jobs: <FileSearchOutlined />,
    resumes: <ProfileOutlined />,
    "resume-upload": <UploadOutlined />,
    "users-directory": <UserOutlined />,
    "admin-users": <SettingOutlined />,
    "admin-roles": <SafetyCertificateOutlined />,
    profile: <UserOutlined />,
  }),
  PARENT_NAVIGATION = Object.freeze({
    "application-detail": "applications",
    "application-new": "applications",
    "application-bulk-create": "applications",
    "application-bulk-assign": "applications",
    "application-batch-detail": "application-batches",
    "assignment-batch-detail": "assignment-batches",
    "tailoring-job-detail": "tailoring-jobs",
    "job-detail": "jobs",
    "resume-detail": "resumes",
    "candidate-profile": "resumes",
    "admin-user-detail": "admin-users",
    "applier-detail": "overview",
  });

function Shell({ route, title, access, logout, headerExtra, client, apiBaseUrl, children }) {
  const [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem("dashboard-sider") !== "expanded";
      } catch {
        return true;
      }
    }),
    [pinned, setPinned] = useState(() => {
      try {
        return localStorage.getItem("dashboard-sider-pinned") === "pinned";
      } catch {
        return false;
      }
    }),
    [narrow, setNarrow] = useState(false),
    items =
      access?.status === "ACTIVE" && access.roles?.length
        ? navigationForAccess(access)
        : [],
    selected = PARENT_NAVIGATION[route.name] || route.name,
    profileName = access?.fullName?.trim(),
    headerName = personDisplayName({
      fullName: profileName,
      email: access?.email,
      userId: access?.userId,
    }),
    sectionLabel =
      NAVIGATION.find((item) => item.name === selected)?.label ||
      "Resume JD Operations",
    pushed = pinned && !collapsed && !narrow;
  const updateCollapsed = useCallback((next, remember = true) => {
    setCollapsed(next);
    if (remember) {
      try {
        localStorage.setItem(
          "dashboard-sider",
          next ? "collapsed" : "expanded",
        );
      } catch {
        // Storage may be disabled; the navigation remains usable for this session.
      }
    }
  }, []);
  const updatePinned = useCallback((next) => {
    setPinned(next);
    try {
      localStorage.setItem("dashboard-sider-pinned", next ? "pinned" : "unpinned");
    } catch {
      // Storage may be disabled; pinning remains usable for this session.
    }
  }, []);
  useEffect(() => {
    const keydown = (event) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        updateCollapsed(!collapsed);
      } else if (event.key === "Escape" && !collapsed) {
        updateCollapsed(true);
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [collapsed, updateCollapsed]);
  return (
    <Layout className="dashboard-layout">
      {!collapsed && narrow && (
        <button
          type="button"
          className="dashboard-sider-mask"
          aria-label="Close Navigation"
          onClick={() => updateCollapsed(true)}
        />
      )}
      <Sider
        className={`dashboard-sider dashboard-sider-overlay${pushed ? " dashboard-sider-pushed" : ""}`}
        breakpoint="lg"
        width={248}
        collapsedWidth={narrow ? 0 : 64}
        collapsed={collapsed}
        collapsible
        trigger={null}
        onBreakpoint={(broken) => {
          setNarrow(broken);
          if (broken) updateCollapsed(true, false);
        }}
      >
        <div className="brand" title="Resume JD Operations">
          <span className="brand-full">Resume JD Operations</span>
          <span className="brand-compact" aria-hidden="true">
            RJ
          </span>
          {!collapsed && !narrow && (
            <Button
              type="text"
              className="sider-pin-trigger"
              aria-label={pinned ? "Unpin navigation" : "Pin navigation open"}
              aria-pressed={pinned}
              title={
                pinned
                  ? "Unpin navigation (currently pushes page content)"
                  : "Pin navigation open (pushes page content instead of covering it)"
              }
              icon={pinned ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => updatePinned(!pinned)}
            />
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selected ? [selected] : []}
          inlineCollapsed={collapsed}
          onClick={() => narrow && updateCollapsed(true)}
          items={items.map((item) => ({
            key: item.name,
            icon: NAV_ICONS[item.name] || <BarsOutlined />,
            label: <a href={item.href}>{item.label}</a>,
            title: item.label,
          }))}
        />
        <Button
          type="text"
          className="sider-edge-trigger"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} navigation (Alt+M)`}
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => updateCollapsed(!collapsed)}
        />
      </Sider>
      <Layout
        className={`dashboard-workspace${pushed ? " dashboard-workspace-pushed" : ""}`}
      >
        <Header className="dashboard-header">
          <Flex align="center" gap="small" className="dashboard-header-title">
            <Button
              type="text"
              className="sider-header-trigger"
              aria-label={
                collapsed ? "Expand navigation" : "Collapse navigation"
              }
              aria-expanded={!collapsed}
              title={`${collapsed ? "Expand" : "Collapse"} navigation (Alt+M)`}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => updateCollapsed(!collapsed)}
            />
            <div className="dashboard-header-heading">
              <Text type="secondary" className="eyebrow">
                {sectionLabel}
              </Text>
              <Text strong>{title}</Text>
            </div>
          </Flex>
          <Space wrap className="dashboard-header-actions" align="center">
            {headerExtra}
            <Tooltip title={access?.email || undefined}>
              <Space align="center" size="small" className="user-identity">
                <UserAvatar
                  className="user-avatar"
                  client={client}
                  apiBaseUrl={apiBaseUrl}
                  userId={access?.userId}
                  name={headerName}
                  size={36}
                  hasAvatar={access?.hasAvatar}
                  avatarUpdatedAt={access?.avatarUpdatedAt}
                />
                <Space orientation="vertical" size={0}>
                  <Text strong className="user-name">
                    {headerName}
                  </Text>
                  {profileName && access?.email ? (
                    <Text type="secondary" className="user-email">
                      {access.email}
                    </Text>
                  ) : null}
                </Space>
              </Space>
            </Tooltip>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              Sign Out
            </Button>
          </Space>
        </Header>
        <Content id="main-content" className="dashboard-content" tabIndex="-1">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}

function Login({ client, apiBaseUrl, onSignedIn, passwordRecovery = false, onPasswordUpdated }) {
  const [mode, setMode] = useState(passwordRecovery ? "reset" : "signin"),
    [message, setMessage] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    registering = mode === "signup",
    forgetting = mode === "forgot",
    resetting = mode === "reset" || passwordRecovery;
  useEffect(() => {
    if (passwordRecovery) setMode("reset");
  }, [passwordRecovery]);
  function switchMode(next) {
    if (passwordRecovery && next !== "reset") return;
    setMode(next);
    setMessage("");
    setSuccess("");
  }
  async function submit(values) {
    setMessage("");
    setSuccess("");
    if (resetting) {
      const check = validateNewPassword({
        password: values.password,
        confirmPassword: values.confirmPassword,
      });
      if (!check.valid) {
        setMessage(Object.values(check.errors).join(" "));
        return;
      }
      setBusy(true);
      try {
        await updatePassword(client, values.password);
        if (onPasswordUpdated) onPasswordUpdated();
        else setSuccess("Password updated. You can continue into the workspace.");
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (forgetting) {
      const check = validatePasswordResetRequest(values.email);
      if (!check.valid) {
        setMessage(Object.values(check.errors).join(" "));
        return;
      }
      setBusy(true);
      try {
        const result = await requestPasswordReset(client, values.email);
        setSuccess(result.message);
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (registering) {
      const check = validateSignUp({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        confirmPassword: values.confirmPassword,
      });
      if (!check.valid) {
        setMessage(Object.values(check.errors).join(" "));
        return;
      }
      setBusy(true);
      try {
        const result = await signUp(client, {
          email: values.email,
          password: values.password,
          fullName: values.fullName,
        });
        if (result.session) onSignedIn(result.session);
        else {
          setSuccess(
            result.message ||
              "Registration received. Sign in after confirming your email if required. An administrator must approve your account.",
          );
          setMode("signin");
        }
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const check = validateLogin(values.email, values.password);
    if (!check.valid) {
      setMessage(Object.values(check.errors).join(" "));
      return;
    }
    setBusy(true);
    try {
      const nextSession = await signIn(client, values.email, values.password);
      void recordLogin(client, apiBaseUrl, "DASHBOARD");
      onSignedIn(nextSession);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  const title = resetting
    ? "Choose New Password"
    : forgetting
      ? "Forgot Password"
      : registering
        ? "Sign Up"
        : "Sign In";
  const description = resetting
    ? "Enter a new password for your account. Use at least 8 characters."
    : forgetting
      ? "Enter your account email and we will send a reset link if it matches an existing account."
      : registering
        ? "Create an account with your full name, email, and password. An administrator must approve your request and assign a role before you can use the workspace."
        : "Use the same Supabase email and password as the Chrome extension.";
  const errorTitle = resetting
    ? "Password Update Failed"
    : forgetting
      ? "Password Reset Failed"
      : registering
        ? "Sign Up Failed"
        : "Sign In Failed";
  return (
    <main className="login-page">
      <Card className="login-card">
        <Text type="secondary" className="eyebrow">
          Resume JD Operations
        </Text>
        <Title level={1} tabIndex={-1}>
          {title}
        </Title>
        <Text>{description}</Text>
        {message && (
          <UiErrorState
            title={errorTitle}
            message={message}
          />
        )}
        {success && (
          <Alert
            type="success"
            showIcon
            message={success}
            style={{ marginTop: 16, marginBottom: 8 }}
          />
        )}
        <Form
          layout="vertical"
          onFinish={submit}
          requiredMark={registering || resetting ? "optional" : false}
          key={mode}
        >
          {registering && (
            <Form.Item
              label="Full Name"
              name="fullName"
              rules={[
                { required: true, message: "Enter your full name." },
                { max: 200, message: "Full name must be at most 200 characters." },
              ]}
            >
              <Input autoComplete="name" maxLength={200} />
            </Form.Item>
          )}
          {!resetting && (
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: "Enter your email address." },
                { type: "email", message: "Enter a valid email address." },
              ]}
            >
              <Input autoComplete="username" />
            </Form.Item>
          )}
          {!forgetting && (
            <Form.Item
              label={resetting ? "New Password" : "Password"}
              name="password"
              rules={[
                { required: true, message: resetting ? "Enter a new password." : "Enter your password." },
                ...((registering || resetting)
                  ? [
                      {
                        min: 8,
                        message: "Password must be at least 8 characters.",
                      },
                    ]
                  : []),
              ]}
            >
              <Input.Password
                autoComplete={registering || resetting ? "new-password" : "current-password"}
              />
            </Form.Item>
          )}
          {(registering || resetting) && (
            <Form.Item
              label="Confirm Password"
              name="confirmPassword"
              dependencies={["password"]}
              rules={[
                { required: true, message: "Confirm your password." },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value)
                      return Promise.resolve();
                    return Promise.reject(new Error("Passwords do not match."));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={busy} block>
            {resetting
              ? "Save New Password"
              : forgetting
                ? "Send Reset Link"
                : registering
                  ? "Sign Up"
                  : "Sign In"}
          </Button>
        </Form>
        {!passwordRecovery && (
          <Flex vertical gap={4} align="center" style={{ marginTop: 16 }}>
            {forgetting ? (
              <Button type="link" onClick={() => switchMode("signin")}>
                Back to Sign In
              </Button>
            ) : registering ? (
              <Button type="link" onClick={() => switchMode("signin")}>
                Already have an account? Sign In
              </Button>
            ) : (
              <>
                <Button type="link" onClick={() => switchMode("forgot")}>
                  Forgot Password?
                </Button>
                <Button type="link" onClick={() => switchMode("signup")}>
                  New member? Sign Up
                </Button>
              </>
            )}
          </Flex>
        )}
      </Card>
    </main>
  );
}

function textSearchFilterDropdown(placeholder) {
  return ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
    <div style={{ padding: 8 }} onKeyDown={(event) => event.stopPropagation()}>
      <Input
        allowClear
        placeholder={placeholder}
        value={selectedKeys[0]}
        onChange={(event) =>
          setSelectedKeys(event.target.value ? [event.target.value] : [])
        }
        onPressEnter={() => confirm()}
        style={{ marginBottom: 8, display: "block" }}
      />
      <Space>
        <Button
          type="primary"
          size="small"
          icon={<SearchOutlined />}
          onClick={() => confirm()}
        >
          Search
        </Button>
        <Button
          size="small"
          onClick={() => {
            clearFilters?.();
            confirm();
          }}
        >
          Reset
        </Button>
      </Space>
    </div>
  );
}

function pickSharedColumnSearch(tableFilters, keys, currentSearch) {
  const current = currentSearch || "";
  const values = keys.map((key) => {
    const entry = tableFilters[key];
    return entry == null ? undefined : String(entry[0] || "");
  });
  const changed = values.find(
    (value) => value !== undefined && value !== current,
  );
  if (changed !== undefined) return changed;
  const present = values.find((value) => value !== undefined);
  return present !== undefined ? present : current;
}

/** Keep Ant Design from client-filtering rows; list APIs already apply filters. */
const serverSideColumnFilter = { onFilter: () => true };

function BusinessOverview({ client, apiBaseUrl, reload, access, dateRange }) {
  const showBusinessRecords = hasCapability(access, CAPABILITIES.USER_ADMIN),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!showBusinessRecords) return undefined;
    let live = true;
    setResult(null);
    setError("");
    getBusinessOverview(client, apiBaseUrl, dateRange)
      .then((value) => live && setResult(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload, dateRange?.from, dateRange?.to, showBusinessRecords]);
  if (!showBusinessRecords) return null;
  if (error) return <ErrorState message={error} />;
  if (!result) return <Loading text="Loading dashboard…" />;
  return (
    <div className="page">
      <BusinessRecordCards
        jobCounts={result.jobCounts}
        resumeCounts={result.resumeCounts}
      />
    </div>
  );
}

function BusinessDashboard({ client, apiBaseUrl, reload, access, period, dateRange }) {
  const isAdmin = hasCapability(access, CAPABILITIES.USER_ADMIN);
  const showProfileWorkload = !isAdmin && !isApplicationManager(access);
  return (
    <>
      <BusinessOverview client={client} apiBaseUrl={apiBaseUrl} reload={reload} access={access} dateRange={dateRange} />
      {isAdmin ? (
        <ApplierProductivitySection
          client={client}
          apiBaseUrl={apiBaseUrl}
          reload={reload}
          dateRange={dateRange}
          dateLabel={period.label}
        />
      ) : null}
      {showProfileWorkload ? (
        <ApplierProfileWorkloadSection
          client={client}
          apiBaseUrl={apiBaseUrl}
          reload={reload}
          dateRange={dateRange}
          dateLabel={period.label}
        />
      ) : null}
    </>
  );
}

function ApplierProfileWorkloadSection({
  client,
  apiBaseUrl,
  reload,
  dateRange,
  dateLabel,
}) {
  const [payload, setPayload] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setPayload(null);
    setError("");
    Promise.all([
      getApplierProfileWorkload(client, apiBaseUrl, dateRange),
      getApplicationCounts(client, apiBaseUrl, dateRange),
    ])
      .then(([rows, counts]) =>
        live &&
        setPayload({
          rows: Array.isArray(rows) ? rows : [],
          applicationCounts: counts || {},
        }),
      )
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload, dateRange?.from, dateRange?.to]);
  if (error) return <div className="page"><ErrorState message={error} /></div>;
  if (!payload) return <div className="page"><Loading text="Loading profile workload…" /></div>;
  return (
    <div className="page">
      <ApplierProfileWorkloadPage
        rows={payload.rows}
        applicationCounts={payload.applicationCounts}
        dateLabel={dateLabel}
      />
    </div>
  );
}

function ApplierProductivitySection({
  client,
  apiBaseUrl,
  reload,
  dateRange,
  dateLabel,
}) {
  const [payload, setPayload] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setPayload(null);
    setError("");
    Promise.all([
      getBusinessOverview(client, apiBaseUrl, dateRange),
      getApplicationCounts(client, apiBaseUrl, dateRange),
    ])
      .then(([overview, counts]) =>
        live &&
        setPayload({
          rows: overview?.applierPerformance || [],
          applicationCounts: counts || {},
        }),
      )
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload, dateRange?.from, dateRange?.to]);
  if (error) return <div className="page"><ErrorState message={error} /></div>;
  if (!payload) return <div className="page"><Loading text="Loading Applier productivity…" /></div>;
  return (
    <div className="page">
      <ApplierProductivityPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        rows={payload.rows}
        applicationCounts={payload.applicationCounts}
        dateLabel={dateLabel}
        dateRange={dateRange}
      />
    </div>
  );
}

function Jobs({
  client,
  apiBaseUrl,
  categories,
  query,
  reload,
  access,
  selectedJobIds,
  onSelectedJobIdsChange,
}) {
  const { message } = AntApp.useApp(),
    toast = (type, content) => toastFromApp(message, type, content),
    filters = parseJobQuery(query),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [exportBusy, setExportBusy] = useState(false),
    [capturers, setCapturers] = useState([]),
    [capturerError, setCapturerError] = useState(""),
    [reviewBusy, setReviewBusy] = useState(false),
    [deleteBusy, setDeleteBusy] = useState(false),
    [openUrlsBusy, setOpenUrlsBusy] = useState(false),
    [reviewDialog, setReviewDialog] = useState(null),
    [reviewComment, setReviewComment] = useState(""),
    [declineReason, setDeclineReason] = useState("EXPIRED"),
    [listReload, setListReload] = useState(0),
    [selectedJobById, setSelectedJobById] = useState({}),
    canBulk = hasCapability(access, CAPABILITIES.APPLICATION_BULK_MANAGE),
    canReview = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE),
    canSelect = canBulk || canReview;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    listJobs(client, apiBaseUrl, filters)
      .then((value) => {
        if (!live) return;
        setData(value);
        setLoading(false);
      })
      .catch((value) => {
        if (!live) return;
        setError(value.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, query, reload, listReload]);
  useEffect(() => {
    if (!selectedJobIds.length) {
      setSelectedJobById({});
      return;
    }
    setSelectedJobById((prev) => {
      const next = {};
      for (const id of selectedJobIds) {
        const fromPage = data?.items?.find((job) => job.id === id);
        if (fromPage) {
          next[id] = {
            reviewStatus: fromPage.review_status,
            sourceUrl: fromPage.source_url,
          };
        } else if (prev[id]) {
          next[id] = prev[id];
        }
      }
      return next;
    });
  }, [data, selectedJobIds]);
  useEffect(() => {
    let live = true;
    setCapturerError("");
    listJobCapturers(client, apiBaseUrl)
      .then((value) => live && setCapturers(value))
      .catch((value) => live && setCapturerError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload]);
  function clearJobSelection() {
    onSelectedJobIdsChange([]);
    setSelectedJobById({});
  }
  function rememberSelectedJobs(rows = []) {
    if (!rows.length) return;
    setSelectedJobById((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (!row?.id) continue;
        next[row.id] = {
          reviewStatus: row.review_status,
          sourceUrl: row.source_url,
        };
      }
      return next;
    });
  }
  async function openSelectedJobUrls() {
    if (!selectedJobIds.length || openUrlsBusy) return;
    setOpenUrlsBusy(true);
    try {
      const urls = [];
      const missing = [];
      for (const id of selectedJobIds) {
        const cached = selectedJobById[id]?.sourceUrl;
        const fromPage = data?.items?.find((job) => job.id === id)?.source_url;
        const url = safeExternalUrl(cached || fromPage);
        if (url) urls.push(url);
        else missing.push(id);
      }
      if (missing.length) {
        const fetched = await Promise.all(
          missing.map(async (id) => {
            try {
              return await getJob(client, apiBaseUrl, id);
            } catch {
              return null;
            }
          }),
        );
        for (const job of fetched) {
          const url = safeExternalUrl(job?.source_url);
          if (url) urls.push(url);
        }
      }
      const result = openExternalUrls(urls, { limit: MAX_OPEN_JOB_URLS });
      if (!result.attempted) {
        toast("warning", "No valid Job Posting URLs in the selection.");
        return;
      }
      let message = `Opened ${result.opened} Job Posting URL${result.opened === 1 ? "" : "s"}.`;
      if (result.blocked) {
        message += ` ${result.blocked} were blocked by the browser popup blocker.`;
      }
      if (result.skipped) {
        message += ` ${result.skipped} were not opened (limit ${MAX_OPEN_JOB_URLS}).`;
      }
      toast(result.blocked || result.skipped ? "warning" : "success", message);
    } catch (value) {
      toast("error", value.message || "Selected Job Posting URLs could not be opened.");
    } finally {
      setOpenUrlsBusy(false);
    }
  }
  async function submitBulkReview(nextStatus, reason = null, comment = "") {
    if (!selectedJobIds.length) return;
    setReviewBusy(true);
    try {
      const result = await bulkReviewJobs(client, apiBaseUrl, {
        jobDescriptionIds: selectedJobIds,
        reviewStatus: nextStatus,
        ...(reason ? { declineReason: reason } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setReviewDialog(null);
      setReviewComment("");
      setDeclineReason("EXPIRED");
      clearJobSelection();
      setListReload((value) => value + 1);
      toast(
        result.failed ? "warning" : "success",
        result.failed
          ? `Updated ${result.succeeded} of ${result.total} Job Descriptions. ${result.failed} could not be updated.`
          : nextStatus === "APPROVED"
            ? `Approved ${result.succeeded} Job Description${result.succeeded === 1 ? "" : "s"}.`
            : nextStatus === "DECLINED"
              ? `Declined ${result.succeeded} Job Description${result.succeeded === 1 ? "" : "s"}.`
              : nextStatus === "NEEDS_CORRECTION"
                ? `Requested corrections on ${result.succeeded} Job Description${result.succeeded === 1 ? "" : "s"}.`
                : `Updated review status for ${result.succeeded} Job Description${result.succeeded === 1 ? "" : "s"}.`,
      );
    } catch (value) {
      toast("error", value.message || "Bulk review could not be completed.");
    } finally {
      setReviewBusy(false);
    }
  }
  async function submitBulkDelete() {
    if (!selectedJobIds.length) return;
    setDeleteBusy(true);
    try {
      const result = await bulkDeleteJobs(client, apiBaseUrl, {
        jobDescriptionIds: selectedJobIds,
      });
      clearJobSelection();
      setListReload((value) => value + 1);
      toast(
        result.failed ? "warning" : "success",
        result.failed
          ? `Deleted ${result.succeeded} of ${result.total} Job Descriptions. ${result.failed} could not be deleted.`
          : `Deleted ${result.succeeded} Job Description${result.succeeded === 1 ? "" : "s"}.`,
      );
    } catch (value) {
      toast("error", value.message || "The selected Job Descriptions could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }
  const update = (patch) => {
      const next = { ...filters, ...patch };
      if (patch.capturedWindow !== undefined && patch.capturedWindow !== "CUSTOM") {
        next.capturedFrom = "";
        next.capturedTo = "";
      }
      const value = serializeQuery(next);
      go(`#/jobs${value ? `?${value}` : ""}`);
    },
    searchFiltered = filters.search ? [filters.search] : null,
    columns = useMemo(
      () =>
        serverSortColumns(
          [
            {
              title: "Company",
              dataIndex: "company",
              sortKey: "company",
              width: 160,
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: textSearchFilterDropdown(
                "Search company or job title",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
              ),
              render: (value) => <EllipsisCell>{value}</EllipsisCell>,
            },
            {
              title: "Job Title",
              dataIndex: "job_title",
              sortKey: "title",
              width: 220,
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: textSearchFilterDropdown(
                "Search company or job title",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
              ),
              render: (value, job) => (
                <EllipsisCell href={`#/jobs/${job.id}`}>{value}</EllipsisCell>
              ),
            },
            {
              title: "Primary Category",
              dataIndex: "category_id",
              sortKey: "category",
              width: 200,
              filters: categories.primary.map((item) => ({
                text: item.name,
                value: item.id,
              })),
              filterMultiple: false,
              filteredValue: filters.categoryId ? [filters.categoryId] : null,
              ...serverSideColumnFilter,
              render: (value) => (
                <MetaTag color={categoryTagColor(categories, value)}>
                  {categoryName(categories, value)}
                </MetaTag>
              ),
            },
            {
              title: "Seniority",
              dataIndex: "seniority",
              sortKey: "seniority",
              width: 130,
              filters: SENIORITIES.map((item) => ({
                text: formatLabel(item),
                value: item,
              })),
              filterMultiple: false,
              filteredValue: filters.seniority ? [filters.seniority] : null,
              ...serverSideColumnFilter,
              render: (value) => <SeniorityTag value={value} />,
            },
            {
              title: "Job Posting URL",
              dataIndex: "source_url",
              sortKey: "source",
              width: 280,
              filters: [
                { text: "Active URLs", value: "ACTIVE" },
                { text: "Declined / archived URLs", value: "ARCHIVED" },
                { text: "All URLs", value: "ALL" },
              ],
              filterMultiple: false,
              filteredValue: [filters.status || "ACTIVE"],
              ...serverSideColumnFilter,
              render: (value) => {
                const source = safeExternalUrl(value);
                return source ? (
                  <EllipsisCell href={source}>{value}</EllipsisCell>
                ) : (
                  "—"
                );
              },
            },
            {
              title: "Captured By",
              dataIndex: "user_id",
              sortKey: "capturer",
              width: 160,
              filters: capturers.map((item) => {
                const name = personDisplayName({
                  displayName: item.displayName,
                  email: item.email,
                  userId: item.id,
                });
                const emailSuffix =
                  item.email && !isEmailLike(name, item.email)
                    ? ` — ${item.email}`
                    : "";
                return {
                  text: `${name}${emailSuffix} (${item.capturedCount})`,
                  value: item.id,
                };
              }),
              filterMultiple: false,
              filteredValue: filters.capturedByUserId
                ? [filters.capturedByUserId]
                : null,
              filterSearch: true,
              ...serverSideColumnFilter,
              render: (_, job) => (
                <MetaTag seed={job.user_id || capturedBy(job)}>
                  {capturedBy(job)}
                </MetaTag>
              ),
            },
            {
              title: "Status",
              dataIndex: "review_status",
              sortKey: "review",
              width: 140,
              filters: [
                { text: "All Review Statuses", value: "ALL" },
                { text: "Needs Review", value: "NEEDS_REVIEW" },
                { text: "Approved", value: "APPROVED" },
                { text: "Needs Correction", value: "NEEDS_CORRECTION" },
                { text: "Declined", value: "DECLINED" },
              ],
              filterMultiple: false,
              filteredValue: [filters.reviewStatus || "ALL"],
              ...serverSideColumnFilter,
              render: (value) => <Badge value={value} />,
            },
            {
              title: "Captured",
              dataIndex: "created_at",
              sortKey: "created",
              width: 170,
              filters: [
                { text: "Today", value: "TODAY" },
                { text: "This Week", value: "THIS_WEEK" },
                { text: "This Month", value: "THIS_MONTH" },
              ],
              filterMultiple: false,
              filteredValue:
                filters.capturedWindow && filters.capturedWindow !== "CUSTOM"
                  ? [filters.capturedWindow]
                  : null,
              ...serverSideColumnFilter,
              render: formatDate,
            },
            {
              title: "",
              key: "action",
              width: 72,
              fixed: "right",
              render: (_, job) => <a href={`#/jobs/${job.id}`}>View</a>,
            },
          ],
          filters.sort,
        ),
      [
        capturers,
        categories,
        filters.capturedByUserId,
        filters.capturedWindow,
        filters.categoryId,
        filters.reviewStatus,
        filters.search,
        filters.seniority,
        filters.sort,
        filters.status,
        searchFiltered,
      ],
    );
  const selectedCount = selectedJobIds.length,
    tooMany = selectedCount > MAX_BULK_JDS,
    hasNeedsReviewSelected = selectedJobIds.some((id) => {
      const reviewStatus =
        selectedJobById[id]?.reviewStatus ??
        data?.items?.find((job) => job.id === id)?.review_status;
      return reviewStatus === "NEEDS_REVIEW";
    }),
    createApplicationsDisabled = !selectedCount || tooMany || hasNeedsReviewSelected,
    jobsTableScrollX = 1580,
    [tableHostRef, tableBodyHeight] = useTableBodyHeight(Boolean(data));
  async function downloadExcel() {
    setExportBusy(true);
    try {
      await exportFilteredJobsExcel(client, apiBaseUrl, filters);
      toast("success", "Excel download started.");
    } catch (value) {
      toast("error", value.message || "Job Descriptions could not be exported.");
    } finally {
      setExportBusy(false);
    }
  }
  return (
    <div className="page page-list">
      <Flex className="page-toolbar" justify="flex-end" align="center" wrap>
        <Space wrap>
          <Button
            loading={exportBusy}
            disabled={!data?.total || loading}
            onClick={downloadExcel}
          >
            Download Excel
          </Button>
          {canSelect && (
            <>
              <Text>{selectedCount} selected</Text>
              <Button
                icon={<LinkOutlined />}
                loading={openUrlsBusy}
                disabled={!selectedCount || reviewBusy || deleteBusy}
                onClick={openSelectedJobUrls}
              >
                Open Selected URLs
              </Button>
              <Button
                onClick={clearJobSelection}
                disabled={!selectedCount || reviewBusy || deleteBusy || openUrlsBusy}
              >
                Clear selection
              </Button>
            </>
          )}
          {canReview && (
            <>
              <Popconfirm
                title="Delete selected Job Descriptions?"
                description="This permanently removes URLs with no Applications. Job Descriptions linked to Applications must be declined instead."
                okText="Delete"
                okButtonProps={{ danger: true, loading: deleteBusy }}
                cancelButtonProps={{ disabled: deleteBusy }}
                onConfirm={submitBulkDelete}
                disabled={!selectedCount || tooMany || reviewBusy || deleteBusy || openUrlsBusy}
              >
                <Button
                  danger
                  loading={deleteBusy}
                  disabled={!selectedCount || tooMany || reviewBusy || openUrlsBusy}
                >
                  Delete Selected
                </Button>
              </Popconfirm>
              <Button
                type="primary"
                loading={reviewBusy}
                disabled={!selectedCount || tooMany || deleteBusy || openUrlsBusy}
                onClick={() => submitBulkReview("APPROVED")}
              >
                Approve Selected
              </Button>
              <Button
                loading={reviewBusy}
                disabled={!selectedCount || tooMany || deleteBusy || openUrlsBusy}
                onClick={() => {
                  setReviewComment("");
                  setReviewDialog("CORRECTION");
                }}
              >
                Needs Correction
              </Button>
              <Button
                danger
                loading={reviewBusy}
                disabled={!selectedCount || tooMany || deleteBusy || openUrlsBusy}
                onClick={() => {
                  setReviewComment("");
                  setDeclineReason("EXPIRED");
                  setReviewDialog("DECLINE");
                }}
              >
                Decline Selected
              </Button>
            </>
          )}
          {canBulk && (
            <Button
              type={canReview ? "default" : "primary"}
              disabled={createApplicationsDisabled}
              title={
                hasNeedsReviewSelected
                  ? "Remove Needs Review Job Descriptions from the selection before creating Applications."
                  : undefined
              }
              onClick={() => go("#/applications/bulk-create")}
            >
              Create Applications
            </Button>
          )}
        </Space>
      </Flex>
      {tooMany && (
        <Alert
          type="error"
          showIcon
          message={`Select no more than ${MAX_BULK_JDS} job descriptions.`}
        />
      )}
      {capturerError && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setCapturerError("")}
          message="Captured-by options could not be loaded."
          description={capturerError}
        />
      )}
      {error && !data ? (
        <ErrorState message={error} />
      ) : !data && loading ? (
        <Loading text="Loading job descriptions…" />
      ) : !data ? (
        <ErrorState message={error || "Job Descriptions could not be loaded."} />
      ) : (
        <Card className="page-list-card">
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 12 }}
            />
          )}
          <div ref={tableHostRef} className="page-list-table-host">
          <AntTable
            className="dashboard-ellipsis-table"
            rowKey="id"
            loading={loading || reviewBusy || deleteBusy || openUrlsBusy}
            columns={columns}
            dataSource={data.items}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: jobsTableScrollX, y: tableBodyHeight }}
            locale={{
              emptyText: (
                <Space direction="vertical" size="small" style={{ padding: 24 }}>
                  <Text strong>No job descriptions</Text>
                  <Text type="secondary">
                    No job descriptions match the current view.
                  </Text>
                  <Button onClick={() => go("#/jobs")}>Clear filters</Button>
                </Space>
              ),
            }}
            onChange={(_pagination, tableFilters, sorter, extra) => {
              if (extra?.action && extra.action !== "filter" && extra.action !== "sort")
                return;
              let search = filters.search;
              try {
                search = normalizeSearch(
                  pickSharedColumnSearch(
                    tableFilters,
                    ["company", "job_title"],
                    filters.search,
                  ),
                );
              } catch {
                search = filters.search;
              }
              const capturedWindow = tableFilters.created_at?.[0] || "";
              update({
                search,
                categoryId: tableFilters.category_id?.[0] || "",
                seniority: tableFilters.seniority?.[0] || "",
                status: tableFilters.source_url?.[0] || "ACTIVE",
                reviewStatus: tableFilters.review_status?.[0] || "ALL",
                capturedByUserId: tableFilters.user_id?.[0] || "",
                capturedWindow,
                sort: serverSortFromTable(sorter, "created_desc"),
                page: 1,
              });
            }}
            rowSelection={
              canSelect
                ? {
                    columnWidth: 48,
                    fixed: true,
                    selectedRowKeys: selectedJobIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys, rows) => {
                      onSelectedJobIdsChange(keys);
                      rememberSelectedJobs(rows);
                    },
                    getCheckboxProps: (job) => {
                      if (canReview) {
                        return {
                          disabled: false,
                          title:
                            job.review_status === "APPROVED" && job.status === "ACTIVE"
                              ? "Selected for review or Create Applications."
                              : "Selected for bulk review.",
                        };
                      }
                      return {
                        disabled:
                          job.status !== "ACTIVE" ||
                          job.review_status !== "APPROVED",
                        title:
                          job.review_status !== "APPROVED"
                            ? "Approve this JD before creating an Application."
                            : job.status !== "ACTIVE"
                              ? "Restore this URL before creating an Application."
                              : undefined,
                      };
                    },
                  }
                : undefined
            }
          />
          </div>
          <Pagination
            data={data}
            pageSizeOptions={JOB_PAGE_SIZES}
            onPage={(page, pageSize) => {
              const nextSize = pageSize || filters.pageSize;
              update({
                page: nextSize !== filters.pageSize ? 1 : page,
                pageSize: nextSize,
              });
            }}
          />
        </Card>
      )}
      <Modal
        open={reviewDialog === "CORRECTION"}
        title={`Request Correction (${selectedCount} selected)`}
        okText="Save"
        confirmLoading={reviewBusy}
        onCancel={() => !reviewBusy && setReviewDialog(null)}
        onOk={() => submitBulkReview("NEEDS_CORRECTION", null, reviewComment)}
        destroyOnHidden
      >
        <Input.TextArea
          value={reviewComment}
          onChange={(event) => setReviewComment(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Optional note for the JD Finder"
        />
      </Modal>
      <Modal
        open={reviewDialog === "DECLINE"}
        title={`Decline Selected JDs (${selectedCount})`}
        okText="Decline"
        okButtonProps={{ danger: true }}
        confirmLoading={reviewBusy}
        onCancel={() => !reviewBusy && setReviewDialog(null)}
        onOk={() => submitBulkReview("DECLINED", declineReason, reviewComment)}
        destroyOnHidden
      >
        <div className="review-dialog-stack">
          <label>
            Decline Reason
            <Select
              style={{ width: "100%", marginTop: 8, marginBottom: 12 }}
              value={declineReason}
              onChange={setDeclineReason}
              options={[
                { value: "EXPIRED", label: "Expired" },
                { value: "NOT_ELIGIBLE", label: "Not Eligible" },
                { value: "DUPLICATE", label: "Duplicate" },
                { value: "INVALID_URL", label: "Invalid URL" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          </label>
          <Input.TextArea
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Optional comment"
          />
        </div>
      </Modal>
    </div>
  );
}

function resumeSearchFilterDropdown(placeholder) {
  return textSearchFilterDropdown(placeholder);
}

function pickResumeSearch(tableFilters, currentSearch) {
  return pickSharedColumnSearch(
    tableFilters,
    ["candidate_name", "resume_name"],
    currentSearch,
  );
}

function Resumes({ client, apiBaseUrl, categories, query, reload, access }) {
  const { message } = AntApp.useApp(),
    toast = (type, content) => toastFromApp(message, type, content),
    filters = parseResumeQuery(query),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [coverBusyId, setCoverBusyId] = useState(""),
    [tableHostRef, tableBodyHeight] = useTableBodyHeight(Boolean(data));
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    listResumes(client, apiBaseUrl, filters)
      .then((value) => live && setData(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, query, reload]);
  async function openListCoverLetter(resume) {
    if (!resume?.cover_letter_storage_path) return;
    setCoverBusyId(resume.id);
    try {
      const url = await createCoverLetterSignedUrl(client, { id: resume.id, apiBaseUrl });
      window.open(url, "_blank", "noopener,noreferrer");
      toast("success", "Cover Letter link opened. It expires shortly.");
    } catch (value) {
      toast("error", value.message);
    } finally {
      setCoverBusyId("");
    }
  }
  const update = (patch) => {
      const value = serializeQuery({ ...filters, ...patch });
      go(`#/resumes${value ? `?${value}` : ""}`);
    },
    searchFiltered = filters.search ? [filters.search] : null,
    columns = useMemo(
      () =>
        serverSortColumns(
          [
            {
              title: "No",
              key: "no",
              width: 64,
              sortable: false,
              render: (_value, _row, index) =>
                ((filters.page || 1) - 1) * (filters.pageSize || 25) + index + 1,
            },
            {
              title: "Candidate",
              dataIndex: "candidate_name",
              sortKey: "candidate",
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: resumeSearchFilterDropdown(
                "Search candidate or resume name",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
              ),
            },
            {
              title: "Resume",
              dataIndex: "resume_name",
              sortKey: "name",
              filteredValue: searchFiltered,
              ...serverSideColumnFilter,
              filterDropdown: resumeSearchFilterDropdown(
                "Search candidate or resume name",
              ),
              filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
              ),
            },
            {
              title: "Primary Category",
              dataIndex: "primary_category_id",
              sortKey: "category",
              filters: categories.primary.map((item) => ({
                text: item.name,
                value: item.id,
              })),
              filterMultiple: false,
              filteredValue: filters.categoryId ? [filters.categoryId] : null,
              ...serverSideColumnFilter,
              render: (_value, row) => formatResumeTechStacks(categories, row, "primary"),
            },
            {
              title: "Subcategory",
              dataIndex: "subcategory_id",
              sortKey: "subcategory",
              render: (_value, row) => formatResumeTechStacks(categories, row, "sub"),
            },
            {
              title: "Seniority",
              dataIndex: "seniority",
              sortKey: "seniority",
              filters: SENIORITIES.map((item) => ({
                text: formatLabel(item),
                value: item,
              })),
              filterMultiple: false,
              filteredValue: filters.seniority ? [filters.seniority] : null,
              ...serverSideColumnFilter,
              render: formatLabel,
            },
            {
              title: "File Type",
              dataIndex: "mime_type",
              sortKey: "mime",
              filters: MIME_TYPES.map((item) => ({
                text: formatMime(item),
                value: item,
              })),
              filterMultiple: false,
              filteredValue: filters.mimeType ? [filters.mimeType] : null,
              ...serverSideColumnFilter,
              render: formatMime,
            },
            {
              title: "Cover Letter",
              dataIndex: "cover_letter_storage_path",
              render: (value, resume) =>
                value ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto" }}
                    loading={coverBusyId === resume.id}
                    onClick={() => openListCoverLetter(resume)}
                  >
                    {resume.cover_letter_original_filename || "Open"}
                  </Button>
                ) : (
                  "—"
                ),
            },
            {
              title: "Updated",
              dataIndex: "updated_at",
              sortKey: "updated",
              render: formatDate,
            },
            {
              title: "Status",
              dataIndex: "status",
              sortKey: "status",
              filters: [
                { text: "Active resumes", value: "ACTIVE" },
                { text: "Archived resumes (history)", value: "ARCHIVED" },
                { text: "All resumes", value: "ALL" },
              ],
              filterMultiple: false,
              filteredValue: [filters.status || "ACTIVE"],
              ...serverSideColumnFilter,
              render: (value) => <Badge value={value} />,
            },
            {
              title: "",
              key: "action",
              render: (_, resume) => (
                <Space>
                  <a href={`#/resumes/${resume.id}`}>View</a>
                  {hasCapability(access, CAPABILITIES.APPLICATION_MANAGE) && (
                    <Text type="secondary">
                      {resume.status === "ARCHIVED" ? "History" : "Current"}
                    </Text>
                  )}
                </Space>
              ),
            },
          ],
          filters.sort,
        ),
      [
        access,
        apiBaseUrl,
        categories,
        client,
        coverBusyId,
        filters.categoryId,
        filters.mimeType,
        filters.page,
        filters.pageSize,
        filters.search,
        filters.seniority,
        filters.sort,
        filters.status,
        searchFiltered,
      ],
    );
  return (
    <div className="page page-list">
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading text="Loading resumes…" />
      ) : (
        <Card className="page-list-card">
          <div ref={tableHostRef} className="page-list-table-host">
          <AntTable
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: tableBodyHeight }}
            locale={{
              emptyText: (
                <Space direction="vertical" size="small" style={{ padding: 24 }}>
                  <Text strong>No resumes</Text>
                  <Text type="secondary">
                    {filters.status === "ARCHIVED"
                      ? "No archived Resume history matches the current filters."
                      : "No active Resumes match the current filters."}
                  </Text>
                  <Button onClick={() => go("#/resumes")}>Clear filters</Button>
                </Space>
              ),
            }}
            onChange={(_pagination, tableFilters, sorter) => {
              let search = filters.search;
              try {
                search = normalizeSearch(
                  pickResumeSearch(tableFilters, filters.search),
                );
              } catch {
                search = filters.search;
              }
              update({
                search,
                categoryId: tableFilters.primary_category_id?.[0] || "",
                seniority: tableFilters.seniority?.[0] || "",
                mimeType: tableFilters.mime_type?.[0] || "",
                status: tableFilters.status?.[0] || "ACTIVE",
                sort: serverSortFromTable(sorter, "candidate_asc"),
                page: 1,
              });
            }}
          />
          </div>
          <Pagination
            data={data}
            pageSizeOptions={PAGE_SIZES}
            onPage={(page, pageSize) => {
              const nextSize = pageSize || filters.pageSize;
              update({
                page: nextSize !== filters.pageSize ? 1 : page,
                pageSize: nextSize,
              });
            }}
          />
        </Card>
      )}
    </div>
  );
}

function JobDetail({ client, apiBaseUrl, categories, id, back, reload, access }) {
  const { message } = AntApp.useApp(),
    toast = (type, content) => toastFromApp(message, type, content),
    [editForm] = Form.useForm();
  const [job, setJob] = useState(),
    [error, setError] = useState(""),
    [statusBusy, setStatusBusy] = useState(false),
    [editOpen, setEditOpen] = useState(false),
    [editBusy, setEditBusy] = useState(false),
    [editCategoryId, setEditCategoryId] = useState(""),
    [reviewDialog, setReviewDialog] = useState(null),
    [reviewComment, setReviewComment] = useState(""),
    [declineReason, setDeclineReason] = useState("EXPIRED"),
    [reviewBusy, setReviewBusy] = useState(false);
  useEffect(() => {
    getJob(client, apiBaseUrl, id)
      .then(setJob)
      .catch((value) => setError(value.message));
  }, [client, apiBaseUrl, id, reload]);
  if (error) return <ErrorState message={error} />;
  if (job === undefined) return <Loading />;
  if (!job)
    return (
      <ErrorState message="Job Description not found or you do not have access to it." />
    );
  const source = safeExternalUrl(job.source_url),
    canReview =
      hasCapability(access, CAPABILITIES.APPLICATION_MANAGE) &&
      job.status === "ACTIVE",
    tabs = [
      {
        key: "overview",
        label: "Overview",
        children: (
          <Meta
            items={[
              ["Primary Category", categoryName(categories, job.category_id)],
              [
                "Subcategory",
                job.subcategory_id
                  ? categoryName(categories, job.subcategory_id)
                  : "None",
              ],
              ["Industry Domain", formatLabel(job.industry_domain)],
              ["Seniority", formatLabel(job.seniority)],
              ["Location", job.location_text || "Not specified / remote"],
              ["Work Arrangement", formatLabel(job.work_arrangement)],
              ["Salary Range", salaryRange(job)],
              ["Original Salary Text", job.salary_text || "—"],
              [
                "Travel Required",
                job.travel_required === null
                  ? "Not specified"
                  : job.travel_required
                    ? "Yes"
                    : "No",
              ],
              ["Travel Details", job.travel_details || "—"],
              ["Source Site", job.source_site],
              ["Captured By", capturedBy(job)],
              ["Capturer User ID", job.user_id],
              ["Review Status", formatLabel(job.review_status)],
              ["Reviewer Comment", job.review_comment || "No comment"],
              ...(job.review_decline_reason ? [["Decline Reason", formatLabel(job.review_decline_reason)]] : []),
              ["Capture Method", formatLabel(job.capture_method)],
              ["Extraction Confidence", formatLabel(job.extraction_confidence)],
              ["Captured At", formatDate(job.created_at)],
              ["Last Updated", formatDate(job.updated_at)],
              ...(job.status === "ARCHIVED" ? [
                ["Declined / Archived At", formatDate(job.archived_at)],
                ["Reviewed By User ID", job.archived_by || "Not recorded"],
                ["Review Reason", formatLabel(job.archive_reason)],
              ] : []),
            ]}
          />
        ),
      },
      {
        key: "requirements",
        label: "Requirements",
        children: (
          <>
            <Card size="small" title="Security Requirements">
              <Tags
                values={job.clearance_requirements?.map(formatLabel)}
                empty="No clearance requirement detected"
              />
            </Card>
            <Card size="small" title="Detected Technology Stack">
              <Tags
                values={job.detected_skills}
                empty="No technology stack detected"
              />
            </Card>
          </>
        ),
      },
      {
        key: "description",
        label: "Job Description",
        children: <div className="long-text">{job.description_text}</div>,
      },
    ];
  async function changeStatus(status) {
    setStatusBusy(true);
    try {
      const next = await setJobStatus(client, apiBaseUrl, job.id, status, status === "ARCHIVED" ? "NOT_APPLICABLE" : undefined);
      setJob((current) => ({ ...current, ...next }));
      toast(
        "success",
        status === "ARCHIVED"
          ? "URL declined and archived. Its capture history remains, and it is excluded from new Applications."
          : "URL restored to active review and new Application Workflows.",
      );
    } catch (value) {
      toast("error", value.message);
    } finally {
      setStatusBusy(false);
    }
  }
  async function submitReview(nextStatus, reason = null, comment = "") {
    setReviewBusy(true);
    try {
      const next = await reviewJob(client, apiBaseUrl, job.id, {
        reviewStatus: nextStatus,
        ...(reason ? { declineReason: reason } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setJob((current) => ({ ...current, ...next }));
      setReviewDialog(null);
      setReviewComment("");
      setDeclineReason("EXPIRED");
      toast(
        "success",
        nextStatus === "APPROVED"
          ? "JD approved. It can be selected for new Applications."
          : nextStatus === "DECLINED"
            ? "JD declined in review."
            : nextStatus === "NEEDS_CORRECTION"
              ? "Correction requested from the JD Finder."
              : "Review Status updated.",
      );
    } catch (value) {
      toast("error", value.message);
    } finally {
      setReviewBusy(false);
    }
  }
  const finderCanEdit = hasCapability(access, CAPABILITIES.JOB_DESCRIPTION_EDIT_OWN) && job.user_id === access.userId && ["NEEDS_REVIEW", "NEEDS_CORRECTION"].includes(job.review_status),
    managerCanEdit =
      canReview &&
      job.status === "ACTIVE" &&
      ["NEEDS_REVIEW", "NEEDS_CORRECTION"].includes(job.review_status),
    canEditJd = finderCanEdit || managerCanEdit;
  function openEdit() {
    const skills = Array.isArray(job.detected_skills) ? job.detected_skills.join(", ") : "";
    editForm.setFieldsValue({
      company: job.company, jobTitle: job.job_title, categoryId: job.category_id,
      subcategoryId: job.subcategory_id || undefined, seniority: job.seniority || "UNSPECIFIED",
      locationText: job.location_text || "", workArrangement: job.work_arrangement || "UNSPECIFIED",
      sourceUrl: job.source_url, descriptionText: job.description_text, detectedSkills: skills,
      salaryText: job.salary_text || "",
    });
    setEditCategoryId(job.category_id);
    setEditOpen(true);
  }
  async function saveEdit() {
    try {
      const values = await editForm.validateFields();
      setEditBusy(true);
      const payload = {
        ...values,
        subcategoryId: values.subcategoryId || null,
        locationText: values.locationText || null,
        detectedSkills: cleanTags(String(values.detectedSkills || "").split(",")),
        clearanceRequirements: job.clearance_requirements || [],
        travelRequired: job.travel_required,
        travelDetails: job.travel_details,
        salaryMin: job.salary_min,
        salaryMax: job.salary_max,
        salaryCurrency: job.salary_currency,
        salaryPeriod: job.salary_period,
        salaryText: values.salaryText || null,
      };
      const next = managerCanEdit
        ? await updateManagedJob(client, apiBaseUrl, job.id, payload)
        : await updateOwnJob(client, apiBaseUrl, job.id, payload);
      setJob((current) => ({ ...current, ...next }));
      setEditOpen(false);
      toast(
        "success",
        managerCanEdit
          ? "Changes saved. You can Approve this JD when ready."
          : job.review_status === "NEEDS_CORRECTION"
            ? "Correction saved. The JD remains in Needs Correction until a manager reviews it again."
            : "Changes saved. The JD remains in the review queue.",
      );
    } catch (value) {
      if (value?.errorFields) return;
      toast("error", value?.message || "The correction could not be saved.");
    } finally {
      setEditBusy(false);
    }
  }
  return (
    <div className="page">
      <a className="back-link" href={back}>
        ← Back to Job Descriptions
      </a>
      <div className="detail-title">
        <div>
          <Text type="secondary" className="eyebrow">
            {job.company}
          </Text>
          <Title level={1} tabIndex={-1}>
            {job.job_title}
          </Title>
        </div>
        <Space><Badge value={job.review_status} />{job.status === "ARCHIVED" && <Badge value={job.status} />}</Space>
      </div>
      <TabbedSections
        items={tabs}
        extra={
          <Space wrap align="center" className="detail-action-group">
            {source ? <Button type="link" href={source} target="_blank" rel="noopener noreferrer">Open original posting</Button> : null}
            {canEditJd && (
              <Button type={managerCanEdit ? "default" : "primary"} onClick={openEdit}>
                {managerCanEdit ? "Edit JD" : "Edit my JD"}
              </Button>
            )}
            {canReview && (
              <>
                <Button
                  type="primary"
                  loading={reviewBusy}
                  disabled={job.review_status === "APPROVED"}
                  onClick={() => submitReview("APPROVED")}
                >
                  Approve
                </Button>
                <Button
                  loading={reviewBusy}
                  onClick={() => {
                    setReviewComment(job.review_comment || "");
                    setReviewDialog("CORRECTION");
                  }}
                >
                  Needs Correction
                </Button>
                <Button
                  danger
                  loading={reviewBusy}
                  disabled={job.review_status === "DECLINED"}
                  onClick={() => {
                    setReviewComment(job.review_comment || "");
                    setDeclineReason(job.review_decline_reason || "EXPIRED");
                    setReviewDialog("DECLINE");
                  }}
                >
                  Decline review
                </Button>
              </>
            )}
            {hasCapability(access, CAPABILITIES.APPLICATION_MANAGE) && (
              <Popconfirm
                title={job.status === "ARCHIVED" ? "Restore this URL?" : "Decline this URL as not applicable?"}
                description={job.status === "ARCHIVED" ? "It will return to active review and can be used for new Applications." : "The JD, source URL, and capture history remain available, but no new Application can use it."}
                okText={job.status === "ARCHIVED" ? "Restore" : "Decline URL"}
                okButtonProps={{ danger: job.status !== "ARCHIVED", loading: statusBusy }}
                onConfirm={() => changeStatus(job.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED")}
              >
                <Button danger={job.status !== "ARCHIVED"} loading={statusBusy}>{job.status === "ARCHIVED" ? "Restore URL" : "Decline / Archive URL"}</Button>
              </Popconfirm>
            )}
          </Space>
        }
      />
      <Modal
        open={reviewDialog === "CORRECTION"}
        title="Request Correction"
        okText="Save"
        confirmLoading={reviewBusy}
        onCancel={() => !reviewBusy && setReviewDialog(null)}
        onOk={() => submitReview("NEEDS_CORRECTION", null, reviewComment)}
        destroyOnHidden
      >
        <Input.TextArea
          value={reviewComment}
          onChange={(event) => setReviewComment(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Optional note for the JD Finder"
        />
      </Modal>
      <Modal
        open={reviewDialog === "DECLINE"}
        title="Decline JD In Review"
        okText="Decline"
        okButtonProps={{ danger: true }}
        confirmLoading={reviewBusy}
        onCancel={() => !reviewBusy && setReviewDialog(null)}
        onOk={() => submitReview("DECLINED", declineReason, reviewComment)}
        destroyOnHidden
      >
        <div className="review-dialog-stack">
          <label>
            Decline Reason
            <Select
              value={declineReason}
              onChange={setDeclineReason}
              options={[
                { value: "EXPIRED", label: "Expired" },
                { value: "NOT_ELIGIBLE", label: "Not Eligible" },
                { value: "DUPLICATE", label: "Duplicate" },
                { value: "INVALID_URL", label: "Invalid URL" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          </label>
          <Input.TextArea
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="Optional comment"
          />
        </div>
      </Modal>
      <Modal open={editOpen} title={managerCanEdit ? "Edit Job Description" : "Edit Captured Job Description"} width={760} okText="Save Changes" confirmLoading={editBusy} onOk={saveEdit} onCancel={() => !editBusy && setEditOpen(false)}>
        <Alert
          type="info"
          showIcon
          message={
            managerCanEdit
              ? "Fix capture details here, then Approve when ready. Needs Correction remains available if you want the JD Finder to revise it instead."
              : job.review_status === "NEEDS_CORRECTION"
                ? "Correct the requested details. The manager's review comment and audit history will be preserved."
                : "You can edit this JD until it is approved or declined."
          }
          style={{ marginBottom: 16 }}
        />
        <Form form={editForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Item name="company" label="Company" rules={[{ required: true }, { max: 200 }]}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="jobTitle" label="Job Title" rules={[{ required: true }, { max: 200 }]}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="categoryId" label="Primary Category" rules={[{ required: true }]}><Select options={(categories?.primary || []).map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => { setEditCategoryId(value); editForm.setFieldValue("subcategoryId", undefined); }} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="subcategoryId" label="Subcategory (optional)"><Select allowClear options={(categories?.childrenByParent?.get(editCategoryId) || []).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="seniority" label="Seniority"><Select options={SENIORITIES.map((value) => ({ value, label: formatLabel(value) }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="workArrangement" label="Work Arrangement"><Select options={["REMOTE","HYBRID","ONSITE","UNSPECIFIED"].map((value) => ({ value, label: formatLabel(value) }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="locationText" label="Location"><Input maxLength={300} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="salaryText" label="Salary Text"><Input maxLength={500} /></Form.Item></Col>
          </Row>
          <Form.Item name="sourceUrl" label="Job Posting URL" rules={[{ required: true }, { type: "url" }, { max: 4000 }]}><Input /></Form.Item>
          <Form.Item name="detectedSkills" label="Technical Skills (Comma-Separated)"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
          <Form.Item name="descriptionText" label="Job Description" rules={[{ required: true }, { min: 100 }, { max: 200000 }]}><Input.TextArea rows={10} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function ResumeBannedCompaniesCard({ client, apiBaseUrl, resumeId, canManage, isOriginal }) {
  const [items, setItems] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [companyName, setCompanyName] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setItems(null);
    setError("");
    listResumeBannedCompanies(client, apiBaseUrl, resumeId)
      .then((value) => live && setItems(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, resumeId]);
  async function addCompany() {
    const name = companyName.trim();
    if (!name) return;
    setBusy(true);
    setMessage("");
    try {
      const row = await addResumeBannedCompany(client, apiBaseUrl, resumeId, name);
      setItems((current) => [...(current || []), row].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName))));
      setCompanyName("");
      setMessage("Company added to the ban list.");
    } catch (value) {
      setMessage(value.message);
    } finally {
      setBusy(false);
    }
  }
  async function removeCompany(entryId) {
    setBusy(true);
    setMessage("");
    try {
      await removeResumeBannedCompany(client, apiBaseUrl, resumeId, entryId);
      setItems((current) => (current || []).filter((item) => item.id !== entryId));
      setMessage("Company removed from the ban list.");
    } catch (value) {
      setMessage(value.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card size="small" title="Banned Companies">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {message && <Alert type="info" showIcon message={message} style={{ marginBottom: 12 }} />}
      {items === null ? (
        <Loading text="Loading banned companies…" />
      ) : items.length ? (
        <Space wrap size={[8, 8]} style={{ marginBottom: canManage && isOriginal ? 12 : 0 }}>
          {items.map((item) =>
            canManage && isOriginal ? (
              <Popconfirm
                key={item.id}
                title="Remove this company from the ban list?"
                okText="Remove"
                okButtonProps={{ danger: true, loading: busy }}
                onConfirm={() => removeCompany(item.id)}
              >
                <Tag style={{ cursor: "pointer" }}>{item.companyName}</Tag>
              </Popconfirm>
            ) : (
              <Tag key={item.id}>{item.companyName}</Tag>
            ),
          )}
        </Space>
      ) : (
        <Text type="secondary" style={{ display: "block", marginBottom: canManage && isOriginal ? 12 : 0 }}>
          None
        </Text>
      )}
      {canManage && isOriginal && (
        <Space.Compact style={{ width: "100%", maxWidth: 420 }}>
          <Input
            value={companyName}
            placeholder="Company Name"
            maxLength={200}
            disabled={busy}
            onChange={(event) => setCompanyName(event.target.value)}
            onPressEnter={addCompany}
          />
          <Button type="primary" loading={busy} disabled={!companyName.trim()} onClick={addCompany}>
            Add
          </Button>
        </Space.Compact>
      )}
      {canManage && isOriginal && (
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          Applications cannot be created for Job Descriptions from these companies with this Resume.
        </Text>
      )}
    </Card>
  );
}

function ResumeDetail({ client, apiBaseUrl, categories, id, back, reload, access }) {
  const { message } = AntApp.useApp(),
    toast = (type, content) => toastFromApp(message, type, content),
    [resume, setResume] = useState(),
    [error, setError] = useState(""),
    [statusBusy, setStatusBusy] = useState(false),
    [coverBusy, setCoverBusy] = useState(false),
    coverInputRef = useRef(null);

  const [editMetadataForm] = Form.useForm(),
    editPrimaryCategoryIds = Form.useWatch("primaryCategoryIds", editMetadataForm) || [],
    [editingMetadata, setEditingMetadata] = useState(false),
    [metadataBusy, setMetadataBusy] = useState(false);

  useEffect(() => {
    getResume(client, apiBaseUrl, id)
      .then(setResume)
      .catch((value) => setError(value.message));
  }, [client, apiBaseUrl, id, reload]);
  if (error) return <ErrorState message={error} />;
  if (resume === undefined) return <Loading />;
  if (!resume)
    return (
      <ErrorState message="Resume not found or you do not have access to it." />
    );
  const canManage = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE),
    isOriginal = resume.resume_type === "ORIGINAL",
    hasCoverLetter = Boolean(resume.cover_letter_storage_path),
    canEditProfileMetadata = hasCapability(access, CAPABILITIES.USER_ADMIN) && isOriginal;

  function beginEditProfileMetadata() {
    const stacks = resumeTechStackRows(resume);
    editMetadataForm.setFieldsValue({
      primaryCategoryIds: [...new Set(stacks.map((row) => row.primary_category_id).filter(Boolean))],
      subcategoryIds: [...new Set(stacks.map((row) => row.subcategory_id).filter(Boolean))],
      seniority: resume.seniority || "UNSPECIFIED",
    });
    setEditingMetadata(true);
  }

  async function submitEditProfileMetadata(values) {
    setMetadataBusy(true);
    try {
      const next = await updateResumeMetadata(client, apiBaseUrl, resume.id, {
        candidateName: resume.candidate_name,
        resumeName: resume.resume_name,
        primaryCategoryIds: values.primaryCategoryIds || [],
        subcategoryIds: values.subcategoryIds || [],
        seniority: values.seniority,
        skills: resume.skills || [],
        industries: resume.industries || [],
      });
      setResume(next);
      setEditingMetadata(false);
      toast("success", "Resume metadata updated.");
    } catch (value) {
      toast("error", value.message || "Could not update resume metadata.");
    } finally {
      setMetadataBusy(false);
    }
  }
  async function open() {
    try {
      const url = await createResumeSignedUrl(client, {id:resume.id,apiBaseUrl});
      window.open(url, "_blank", "noopener,noreferrer");
      toast("success", "Secure link opened. It expires shortly.");
    } catch (value) {
      toast("error", value.message);
    }
  }
  async function openCoverLetter() {
    try {
      const url = await createCoverLetterSignedUrl(client, { id: resume.id, apiBaseUrl });
      window.open(url, "_blank", "noopener,noreferrer");
      toast("success", "Cover Letter link opened. It expires shortly.");
    } catch (value) {
      toast("error", value.message);
    }
  }
  async function onCoverLetterSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCoverBusy(true);
    try {
      const next = await uploadResumeCoverLetter(client, { id: resume.id, apiBaseUrl, file });
      setResume((current) => ({ ...current, ...next }));
      toast("success", hasCoverLetter ? "Cover Letter replaced." : "Cover Letter uploaded.");
    } catch (value) {
      toast("error", value.message);
    } finally {
      setCoverBusy(false);
    }
  }
  async function removeCoverLetter() {
    setCoverBusy(true);
    try {
      const next = await removeResumeCoverLetter(client, { id: resume.id, apiBaseUrl });
      setResume((current) => ({ ...current, ...next }));
      toast("success", "Cover Letter removed.");
    } catch (value) {
      toast("error", value.message);
    } finally {
      setCoverBusy(false);
    }
  }
  async function changeStatus(status) {
    setStatusBusy(true);
    try {
      const next = await setResumeStatus(client, apiBaseUrl, resume.id, status);
      setResume((current) => ({ ...current, ...next }));
      toast(
        "success",
        status === "ARCHIVED"
          ? "Resume archived. It is now retained as history and excluded from new work."
          : "Resume restored and available for new work.",
      );
    } catch (value) {
      toast("error", value.message);
    } finally {
      setStatusBusy(false);
    }
  }
  const structured = resume.structured_content || {},
    tabs = [
      {
        key: "overview",
        label: "Overview",
        children: (
          <>
            <Meta
              items={[
                ["Resume Number", resume.resume_number ? `#${resume.resume_number}` : "Not assigned"],
                ["Resume Name", resume.resume_name || "Not recorded"],
                ["Resume Type", formatLabel(resume.resume_type || "ORIGINAL")],
                ["Parent Resume", resume.parent_resume_id ? "Original Resume available from this Application's tailoring history" : "None — this is an original Resume"],
                ["Candidate Email", resume.candidate_email || "Not recorded"],
                ["Candidate Phone", resume.candidate_phone || "Not recorded"],
                ["Autofill Metadata", formatLabel(resume.profile_review_status)],
                ["Metadata Reviewed At", formatDate(resume.profile_reviewed_at)],
                [
                  "Primary Category",
                  formatResumeTechStacks(categories, resume, "primary"),
                ],
                [
                  "Subcategory",
                  formatResumeTechStacks(categories, resume, "sub"),
                ],
                ["Seniority", formatLabel(resume.seniority)],
                [
                  "Structured Schema Version",
                  resume.structured_schema_version || "Legacy",
                ],
                ["Original Filename", resume.original_filename],
                ["File Type", formatMime(resume.mime_type)],
                ["File Size", formatBytes(resume.file_size_bytes)],
                [
                  "Cover Letter",
                  hasCoverLetter
                    ? `${resume.cover_letter_original_filename} (${formatBytes(resume.cover_letter_file_size_bytes)})`
                    : "None",
                ],
                ["Created At", formatDate(resume.created_at)],
                ["Last Updated", formatDate(resume.updated_at)],
                ...(resume.status === "ARCHIVED" ? [
                  ["Archived At", formatDate(resume.archived_at)],
                  ["Archived By User ID", resume.archived_by || "Not recorded"],
                ] : []),
              ]}
            />
            {canEditProfileMetadata && (
              <Card size="small" title="Profile metadata" style={{ marginTop: 12 }}>
                {editingMetadata ? (
                  <Form
                    form={editMetadataForm}
                    layout="vertical"
                    onFinish={submitEditProfileMetadata}
                  >
                    <Form.Item
                      label="Primary category"
                      name="primaryCategoryIds"
                      rules={[{ required: true, type: "array", min: 1, message: "Select at least one primary category." }]}
                    >
                      <Select
                        mode="multiple"
                        options={(categories?.primary || []).map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) => {
                          const allowed = new Set(value || []);
                          const current = editMetadataForm.getFieldValue("subcategoryIds") || [];
                          editMetadataForm.setFieldValue(
                            "subcategoryIds",
                            current.filter((id) => {
                              const row = categories?.byId?.get(id);
                              return row?.parent_id && allowed.has(row.parent_id);
                            }),
                          );
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={
                        <>
                          Subcategory <Text type="secondary">(optional)</Text>
                        </>
                      }
                      name="subcategoryIds"
                    >
                      <Select
                        mode="multiple"
                        allowClear
                        options={editPrimaryCategoryIds.flatMap((id) =>
                          (categories?.childrenByParent?.get(id) || []).map((item) => ({
                            value: item.id,
                            label: `${categories?.byId?.get(id)?.name || ""} · ${item.name}`.replace(/^ · /, item.name),
                          })),
                        )}
                      />
                    </Form.Item>
                    <Form.Item label="Seniority" name="seniority" rules={[{ required: true }]}>
                      <Select options={SENIORITIES.map((value) => ({ value, label: formatLabel(value) }))} />
                    </Form.Item>
                    <Space wrap>
                      <Button type="primary" htmlType="submit" loading={metadataBusy}>
                        Save changes
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingMetadata(false);
                          editMetadataForm.resetFields();
                        }}
                        disabled={metadataBusy}
                      >
                        Cancel
                      </Button>
                    </Space>
                  </Form>
                ) : (
                  <Space wrap align="center">
                    <Button size="small" onClick={beginEditProfileMetadata} loading={metadataBusy}>
                      Edit profile metadata
                    </Button>
                     <Text type="secondary">
                       Primary categories, subcategories, and seniority.
                     </Text>
                  </Space>
                )}
              </Card>
            )}
            <Card size="small" title="Skills">
              <Tags values={resume.skills} empty="No skills recorded" />
            </Card>
            <Card size="small" title="Industries">
              <Tags values={resume.industries} empty="No industries recorded" />
            </Card>
            <ResumeBannedCompaniesCard
              client={client}
              apiBaseUrl={apiBaseUrl}
              resumeId={resume.id}
              canManage={canManage}
              isOriginal={isOriginal}
            />
          </>
        ),
      },
      {
        key: "structured",
        label: "Structured Resume",
        children: (
          <StructuredResumeView
            content={structured}
            version={resume.structured_schema_version}
          />
        ),
      },
      {
        key: "original",
        label: "Original Text",
        children: <div className="long-text">{resume.resume_text}</div>,
      },
      ...(canManage?[{
        key:"answers",
        label:"Answer Library",
        children:<ResumeAnswerLibrary client={client} apiBaseUrl={apiBaseUrl} resumeId={resume.id}/>,
      }]:[]),
    ];
  return (
    <div className="page">
      <a className="back-link" href={back}>
        ← Back to Resumes
      </a>
      <div className="detail-title">
        <div>
          <Text type="secondary" className="eyebrow">
            {resume.candidate_name}
          </Text>
          <Title level={1} tabIndex={-1}>
            {resume.resume_name}{resume.resume_number ? ` #${resume.resume_number}` : ""}
          </Title>
        </div>
        <Badge value={resume.status} />
      </div>
      <input
        ref={coverInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ display: "none" }}
        onChange={onCoverLetterSelected}
      />
      <TabbedSections
        items={tabs}
        extra={
          <Space wrap align="center" className="detail-action-group">
            <Button type="primary" onClick={open}>Open Original Resume</Button>
            {hasCoverLetter && <Button onClick={openCoverLetter}>Open Cover Letter</Button>}
            {canManage && isOriginal && (
              <Button loading={coverBusy} onClick={() => coverInputRef.current?.click()}>
                {hasCoverLetter ? "Replace Cover Letter" : "Upload Cover Letter"}
              </Button>
            )}
            {canManage && isOriginal && hasCoverLetter && (
              <Popconfirm
                title="Remove this cover letter?"
                description="The file will be deleted. You can upload another later."
                okText="Remove"
                okButtonProps={{ danger: true, loading: coverBusy }}
                onConfirm={removeCoverLetter}
              >
                <Button danger loading={coverBusy}>Remove Cover Letter</Button>
              </Popconfirm>
            )}
            {canManage&&resume.status==="ACTIVE"&&<Button href={`#/resumes/${resume.id}/autofill`}>Edit Structured Resume</Button>}
            {canManage&&isOriginal&&(
              <Popconfirm
                title={resume.status === "ARCHIVED" ? "Restore this Resume?" : "Archive this Resume?"}
                description={resume.status === "ARCHIVED" ? "The Resume will become available for new Applications and tailoring." : "The file and existing Application history will remain, but the Resume will be excluded from new work."}
                okText={resume.status === "ARCHIVED" ? "Restore" : "Archive"}
                okButtonProps={{ danger: resume.status !== "ARCHIVED", loading: statusBusy }}
                onConfirm={() => changeStatus(resume.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED")}
              >
                <Button danger={resume.status !== "ARCHIVED"} loading={statusBusy}>{resume.status === "ARCHIVED" ? "Restore Resume" : "Archive Resume"}</Button>
              </Popconfirm>
            )}
          </Space>
        }
      />
    </div>
  );
}

export function ConfigurationError({ message }) {
  return (
    <main className="config-page">
      <Card className="login-card">
        <UiErrorState
          title="Dashboard Setup Required"
          message={
            <>
              {message}
              <br />
              Create dashboard/.env.local from dashboard/.env.example, then
              restart or rebuild.
            </>
          }
        />
      </Card>
    </main>
  );
}

export function App({ client, apiBaseUrl }) {
  const [session, setSession] = useState(undefined),
    [passwordRecovery, setPasswordRecovery] = useState(false),
    [access, setAccess] = useState(undefined),
    [accessError, setAccessError] = useState(null),
    [route, setRoute] = useState(() => parseRoute(location.hash || "#/")),
    [categories, setCategories] = useState(null),
    [roles, setRoles] = useState([]),
    [selectedBulkJobIds, setSelectedBulkJobIds] = useState([]),
    [overviewPeriod, setOverviewPeriod] = useState(DEFAULT_OVERVIEW_WINDOW),
    [reload] = useState(0),
    sessionRef = useRef(undefined),
    jobsBack = useRef("#/jobs"),
    resumesBack = useRef("#/resumes"),
    overviewDateRange = useMemo(() => overviewDateBounds(overviewPeriod), [overviewPeriod]);
  const reloadAccess = useCallback(async () => {
    if (!session || passwordRecovery) return;
    setAccessError(null);
    try {
      const next = await getMyAccessContext(client, apiBaseUrl);
      setAccess(next);
      return next;
    } catch (error) {
      setAccess(null);
      setAccessError(error);
    }
  }, [client, apiBaseUrl, session, passwordRecovery]);
  useEffect(() => {
    getSession(client)
      .then((next) => {
        sessionRef.current = next;
        setSession(next);
      })
      .catch(() => {
        sessionRef.current = null;
        setSession(null);
      });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      const decision = authStateDecision(event, sessionRef.current, next);
      if (!decision.apply) return;
      sessionRef.current = next;
      setSession(next);
      if (decision.resetAccess) {
        setAccess(undefined);
        setAccessError(null);
      }
    });
    const hash = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", hash);
    if (!location.hash) location.hash = "#/";
    return () => {
      data.subscription.unsubscribe();
      removeEventListener("hashchange", hash);
    };
  }, [client]);
  useEffect(() => {
    if (session && !passwordRecovery) reloadAccess();
    else if (!session) {
      setAccess(undefined);
      setCategories(null);
      setRoles([]);
    }
  }, [session, passwordRecovery, reloadAccess]);
  useEffect(() => {
    let live = true;
    if (
      access &&
      hasCapability(access, CAPABILITIES.JOB_DESCRIPTION_READ) &&
      !categories
    )
      loadCategories(client, apiBaseUrl)
        .then((value) => live && setCategories(value))
        .catch(setAccessError);
    if (access && !hasCapability(access, CAPABILITIES.JOB_DESCRIPTION_READ))
      setCategories(null);
    if (access && hasCapability(access, CAPABILITIES.USER_ADMIN))
      listSystemRoles(client, apiBaseUrl)
        .then((value) => live && setRoles(value))
        .catch(setAccessError);
    else setRoles([]);
    return () => {
      live = false;
    };
  }, [access, client, apiBaseUrl, categories]);
  useEffect(() => {
    if (session !== undefined && (!session || access)) {
      const redirect = guardAccessRoute(route, session, access);
      if (redirect) go(redirect, true);
    }
    document.title = `${route.name === "overview" ? "Overview" : formatLabel(route.name)} — Resume JD Operations`;
    queueMicrotask(() => document.querySelector("h1")?.focus());
  }, [route, session, access]);
  if (session === undefined) return <Loading text="Restoring session…" />;
  if (!session || passwordRecovery)
    return (
      <Login
        client={client}
        apiBaseUrl={apiBaseUrl}
        passwordRecovery={passwordRecovery}
        onSignedIn={(next) => {
          setPasswordRecovery(false);
          setSession(next);
          go("#/", true);
        }}
        onPasswordUpdated={() => {
          setPasswordRecovery(false);
          go("#/", true);
        }}
      />
    );
  const logout = async () => {
    await signOut(client);
    sessionRef.current = null;
    setSession(null);
    setAccess(undefined);
    setCategories(null);
    setRoles([]);
    setSelectedBulkJobIds([]);
    go("#/login", true);
  };
  if (accessError)
    return (
      <Shell
        route={route}
        title="Access Error"
        access={{ email: session.user.email, status: "INACTIVE", roles: [] }}
        logout={logout}
        client={client}
        apiBaseUrl={apiBaseUrl}
      >
        <AccessLoadErrorPage error={accessError} retry={reloadAccess} />
      </Shell>
    );
  if (access === undefined) return <Loading text="Loading account access…" />;
  const guarded = guardAccessRoute(route, session, access);
  if (guarded === "#/pending-access")
    return (
      <Shell
        route={route}
        title="Pending Access"
        access={access}
        logout={logout}
        client={client}
        apiBaseUrl={apiBaseUrl}
      >
        <PendingAccessPage />
      </Shell>
    );
  if (guarded === "#/account-inactive")
    return (
      <Shell
        route={route}
        title="Account Inactive"
        access={access}
        logout={logout}
        client={client}
        apiBaseUrl={apiBaseUrl}
      >
        <InactiveAccountPage />
      </Shell>
    );
  if (guarded === "#/access-denied")
    return (
      <Shell
        route={route}
        title="Access Denied"
        access={access}
        logout={logout}
        client={client}
        apiBaseUrl={apiBaseUrl}
      >
        <AccessDeniedPage />
      </Shell>
    );
  const needsCategories =
    hasCapability(access, CAPABILITIES.JOB_DESCRIPTION_READ) &&
    [
      "overview",
      "jobs",
      "job-detail",
      "resumes",
      "resume-detail",
      "resume-upload",
      "applications",
    ].includes(route.name);
  if (needsCategories && !categories)
    return <Loading text="Loading categories…" />;
  if (
    hasCapability(access, CAPABILITIES.USER_ADMIN) &&
    ["admin-users", "admin-user-detail", "admin-roles"].includes(route.name) &&
    !roles.length
  )
    return <Loading text="Loading system roles…" />;
  if (route.name === "jobs") jobsBack.current = location.hash;
  if (route.name === "resumes") resumesBack.current = location.hash;
  let page;
  if (route.name === "pending-access") page = <PendingAccessPage />;
  else if (route.name === "account-inactive") page = <InactiveAccountPage />;
  else if (route.name === "access-denied") page = <AccessDeniedPage />;
  else if (route.name === "profile")
    page = (
      <ProfilePage
        client={client}
        apiBaseUrl={apiBaseUrl}
        access={access}
        reloadAccess={reloadAccess}
      />
    );
  else if (route.name === "overview")
    page = hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ) ? (
      <BusinessDashboard client={client} apiBaseUrl={apiBaseUrl} reload={reload} access={access} period={overviewPeriod} dateRange={overviewDateRange} />
    ) : (
      <TechnicalOverview access={access} />
    );
  else if (route.name === "applications")
    page = (
      <ApplicationsPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        access={access}
        categories={categories}
        query={route.query}
        reload={reload}
      />
    );
  else if (route.name === "candidate-profile")
    page = <CandidateProfilePage client={client} apiBaseUrl={apiBaseUrl} id={route.id} />;
  else if (route.name === "application-new")
    page = <CreateApplicationPage client={client} apiBaseUrl={apiBaseUrl} />;
  else if (route.name === "application-bulk-create")
    page = (
      <BulkCreatePage
        client={client}
        apiBaseUrl={apiBaseUrl}
        selectedJobIds={selectedBulkJobIds}
        onClearJobSelection={() => setSelectedBulkJobIds([])}
      />
    );
  else if (route.name === "application-bulk-assign")
    page = <BulkAssignmentWizardPage client={client} apiBaseUrl={apiBaseUrl} query={route.query} />;
  else if (route.name === "application-detail")
    page = (
      <ApplicationDetailPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        access={access}
        id={route.id}
        reload={reload}
      />
    );
  else if (route.name === "application-batches")
    page = <ApplicationBatchesPage client={client} apiBaseUrl={apiBaseUrl} query={route.query} />;
  else if (route.name === "application-batch-detail")
    page = <ApplicationBatchDetailPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} />;
  else if (route.name === "assignment-batches")
    page = <AssignmentBatchesPage client={client} apiBaseUrl={apiBaseUrl} />;
  else if (route.name === "assignment-batch-detail")
    page = <AssignmentBatchDetailPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} />;
  else if (route.name === "applier-workloads")
    page = <ApplierWorkloadsPage client={client} apiBaseUrl={apiBaseUrl} />;
  else if (route.name === "applier-directory" || route.name === "users-directory")
    page = <ApplierDirectoryPage client={client} apiBaseUrl={apiBaseUrl} reload={reload} />;
  else if (route.name === "tailoring-jobs")
    page = <TailoringQueuePage client={client} apiBaseUrl={apiBaseUrl} reload={reload} />;
  else if (route.name === "tailoring-job-detail")
    page = <TailoringReviewPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} reload={reload} />;
  else if (route.name === "tailoring-batches")
    page = <TailoringBatchesPage client={client} apiBaseUrl={apiBaseUrl} />;
  else if (route.name === "tailoring-batch-detail")
    page = <TailoringBatchDetailPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} />;
  else if (route.name === "jobs")
    page = (
      <Jobs
        client={client}
        apiBaseUrl={apiBaseUrl}
        categories={categories}
        query={route.query}
        reload={reload}
        access={access}
        selectedJobIds={selectedBulkJobIds}
        onSelectedJobIdsChange={setSelectedBulkJobIds}
      />
    );
  else if (route.name === "job-detail")
    page = (
      <JobDetail
        client={client}
        apiBaseUrl={apiBaseUrl}
        categories={categories}
        id={route.id}
        back={jobsBack.current}
        reload={reload}
        access={access}
      />
    );
  else if (route.name === "resumes")
    page = (
      <Resumes
        client={client}
        apiBaseUrl={apiBaseUrl}
        categories={categories}
        query={route.query}
        reload={reload}
        access={access}
      />
    );
  else if (route.name === "resume-detail")
    page = (
      <ResumeDetail
        client={client}
        apiBaseUrl={apiBaseUrl}
        categories={categories}
        id={route.id}
        back={resumesBack.current}
        reload={reload}
        access={access}
      />
    );
  else if (route.name === "resume-upload")
    page = (
      <AdminResumeUploadPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        access={access}
        categories={categories}
      />
    );
  else if (route.name === "admin-users")
    page = (
      <AdminUsersPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        roles={roles}
        query={route.query}
        reload={reload}
      />
    );
  else if (route.name === "admin-user-detail")
    page = (
      <AdminUserDetailPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        id={route.id}
        roles={roles}
        currentUserId={access.userId}
        onCurrentUserChanged={reloadAccess}
      />
    );
  else if (route.name === "admin-roles")
    page = <AdminRolesPage roles={roles} />;
  else if (route.name === "applier-detail")
    page = (
      <ApplierDetailPage
        client={client}
        apiBaseUrl={apiBaseUrl}
        id={route.id}
      />
    );
  else
    page = (
      <div className="page">
        <Card>
          <Title level={1} tabIndex={-1}>
            Page not found
          </Title>
          <Text>
            {route.name === "invalid-id"
              ? "The record identifier is invalid."
              : "The requested page does not exist."}
          </Text>
          <div>
            <Button type="link" href="#/">
              Return to Overview
            </Button>
          </div>
        </Card>
      </div>
    );
  return (
    <Shell
      route={route}
      title={formatLabel(route.name)}
      access={access}
      logout={logout}
      client={client}
      apiBaseUrl={apiBaseUrl}
      headerExtra={route.name === "overview" && hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ) ? <OverviewDateFilter compact value={overviewPeriod} onChange={setOverviewPeriod} /> : null}
    >
      {page}
    </Shell>
  );
}
