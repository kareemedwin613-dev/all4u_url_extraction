import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Layout,
  Menu,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table as AntTable,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  BarsOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { parseRoute } from "./router.js";
import { getSession, signIn, signOut } from "./services/auth-service.js";
import { authStateDecision } from "./services/auth-state.js";
import { categoryName, loadCategories } from "./services/category-service.js";
import { getJob, listJobCapturers, listJobs, setJobStatus } from "./services/job-read-service.js";
import { getResume, listResumes, setResumeStatus } from "./services/resume-read-service.js";
import { getBusinessOverview } from "./services/business-overview-service.js";
import { ApplierPerformanceChart } from "./features/overview/applier-performance-chart.jsx";
import { createResumeSignedUrl } from "./services/storage-read-service.js";
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
import {
  parseJobQuery,
  parseResumeQuery,
  serializeQuery,
} from "./shared/query-state.js";
import { normalizeSearch, validateLogin } from "./shared/validation.js";
import { safeExternalUrl } from "./shared/url.js";
import {
  JOB_SORTS,
  MIME_TYPES,
  PAGE_SIZES,
  RESUME_SORTS,
  SENIORITIES,
} from "./shared/constants.js";
import {
  serverSortColumns,
  serverSortFromTable,
} from "./shared/table-sorting.js";
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
import {
  ApplicationCountCards,
  ApplicationDetailPage,
  ApplicationsPage,
  CreateApplicationPage,
} from "./features/applications/application-pages.jsx";
import {
  ApplicationBatchDetailPage,
  ApplicationBatchesPage,
  BulkCreatePage,
} from "./features/bulk-applications/bulk-pages.jsx";
import { MAX_BULK_JDS } from "./features/bulk-applications/bulk-state.js";
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
  EmptyState,
  ErrorState as UiErrorState,
  FilterPanel,
  LegacyTable,
  LoadingState,
  Metadata,
  StatusTag,
  TabbedSections,
  TagList,
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
  job?.captured_by?.display_name?.trim() ||
  job?.captured_by?.email ||
  job?.user_id ||
  "Unknown user";
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
  });

function Shell({ route, title, access, refresh, logout, children }) {
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
          aria-label="Close navigation"
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
          <span className="brand-full">
            Resume JD
            <br />
            Operations
          </span>
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
          <Space wrap className="dashboard-header-actions">
            {refresh && (
              <Button icon={<ReloadOutlined />} onClick={refresh}>
                Refresh
              </Button>
            )}
            <Space orientation="vertical" size={0} className="user-identity">
              <Text strong>{profileName || access?.email}</Text>
              {profileName && (
                <Text type="secondary" className="user-email">
                  {access?.email}
                </Text>
              )}
            </Space>
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

function Login({ client, onSignedIn }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(values) {
    const check = validateLogin(values.email, values.password);
    if (!check.valid) {
      setMessage(Object.values(check.errors).join(" "));
      return;
    }
    setBusy(true);
    try {
      onSignedIn(await signIn(client, values.email, values.password));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <Card className="login-card">
        <Text type="secondary" className="eyebrow">
          Resume JD Operations
        </Text>
        <Title level={1} tabIndex={-1}>
          Sign in
        </Title>
        <Text>
          Use the same Supabase email and password as the Chrome extension.
        </Text>
        {message && <UiErrorState title="Sign in failed" message={message} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
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
          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: "Enter your password." }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} block>
            Sign In
          </Button>
        </Form>
      </Card>
    </main>
  );
}

function FilterForm({ kind, value, categories, capturers = [], capturersLoading = false, onApply, onClear }) {
  function submit(raw) {
    try {
      const captured = kind === "jobs" ? raw.capturedWindow : "";
      if (captured === "CUSTOM" && raw.capturedFrom > raw.capturedTo) throw new Error("The captured start date must not be after the end date.");
      onApply({
        ...raw,
        ...(kind === "jobs" && captured !== "CUSTOM" ? { capturedFrom: "", capturedTo: "" } : {}),
        search: normalizeSearch(raw.search),
        page: 1,
        pageSize: Number(raw.pageSize),
      });
    } catch (error) {
      window.alert(error.message);
    }
  }
  const sortMap = kind === "jobs" ? JOB_SORTS : RESUME_SORTS,
    sorts = Object.keys(sortMap).map((option) => ({
      value: option,
      label: option.split("_").map(formatLabel).join(" · "),
    })),
    formKey = serializeQuery(value),
    field = { xs: 24, sm: 12, lg: 6 },
    activeCount = [
      value.search,
      value.categoryId,
      value.seniority,
      value.status,
      kind === "jobs" ? value.capturedByUserId : "",
      kind === "jobs" ? value.capturedWindow : "",
      kind === "resumes" ? value.mimeType : "",
    ].filter(Boolean).length;
  return (
    <FilterPanel activeCount={activeCount}>
      <Form
        key={formKey}
        layout="vertical"
        initialValues={value}
        onFinish={submit}
      >
        <Row gutter={12}>
          <Col {...field}>
            <Form.Item
              label={`Search ${kind === "jobs" ? "company or job title" : "candidate or resume name"}`}
              name="search"
            >
              <Input.Search maxLength={100} allowClear />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Primary category" name="categoryId">
              <Select
                options={[
                  { value: "", label: "All categories" },
                  ...categories.primary.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Seniority" name="seniority">
              <Select
                options={[
                  { value: "", label: "All seniority" },
                  ...SENIORITIES.map((item) => ({
                    value: item,
                    label: formatLabel(item),
                  })),
                ]}
              />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Status" name="status">
              <Select
                options={kind === "resumes" ? [
                  { value: "ACTIVE", label: "Active resumes" },
                  { value: "ARCHIVED", label: "Archived resumes (history)" },
                  { value: "ALL", label: "All resumes" },
                ] : [
                  { value: "ACTIVE", label: "Active URLs" },
                  { value: "ARCHIVED", label: "Declined / archived URLs" },
                  { value: "ALL", label: "All URLs" },
                ]}
              />
            </Form.Item>
          </Col>
          {kind === "resumes" && (
            <Col {...field}>
              <Form.Item label="File type" name="mimeType">
                <Select
                  options={[
                    { value: "", label: "All file types" },
                    ...MIME_TYPES.map((item) => ({
                      value: item,
                      label: formatMime(item),
                    })),
                  ]}
                />
              </Form.Item>
            </Col>
          )}
          {kind === "jobs" && (
            <Col {...field}>
              <Form.Item label="Captured by" name="capturedByUserId">
                <Select
                  showSearch
                  optionFilterProp="label"
                  loading={capturersLoading}
                  options={[
                    { value: "", label: "All users" },
                    ...capturers.map((item) => ({
                      value: item.id,
                      label: `${item.displayName}${item.email && item.email !== item.displayName ? ` — ${item.email}` : ""} (${item.capturedCount})`,
                    })),
                  ]}
                />
              </Form.Item>
            </Col>
          )}
          {kind === "jobs" && (
            <Col {...field}>
              <Form.Item label="Captured time window" name="capturedWindow">
                <Select options={[{value:"",label:"Any time"},{value:"TODAY",label:"Today"},{value:"THIS_WEEK",label:"This week"},{value:"THIS_MONTH",label:"This month"},{value:"CUSTOM",label:"Custom range"}]}/>
              </Form.Item>
            </Col>
          )}
          {kind === "jobs" && <Form.Item noStyle shouldUpdate={(before,after)=>before.capturedWindow!==after.capturedWindow}>{({getFieldValue})=>getFieldValue("capturedWindow")==="CUSTOM"?<><Col {...field}><Form.Item label="Captured from" name="capturedFrom" rules={[{required:true,message:"Select the first date."}]}><Input type="date"/></Form.Item></Col><Col {...field}><Form.Item label="Captured through" name="capturedTo" rules={[{required:true,message:"Select the last date."}]}><Input type="date"/></Form.Item></Col></>:null}</Form.Item>}
          <Col {...field}>
            <Form.Item label="Sort" name="sort">
              <Select options={sorts} />
            </Form.Item>
          </Col>
          <Col {...field}>
            <Form.Item label="Page size" name="pageSize">
              <Select
                options={PAGE_SIZES.map((item) => ({
                  value: item,
                  label: String(item),
                }))}
              />
            </Form.Item>
          </Col>
          <Col {...field} className="filter-actions">
            <Space>
              <Button type="primary" htmlType="submit">
                Apply
              </Button>
              <Button onClick={onClear}>Clear filters</Button>
            </Space>
          </Col>
        </Row>
      </Form>
    </FilterPanel>
  );
}

function BusinessOverview({ client, apiBaseUrl, categories, reload, access }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    getBusinessOverview(client, apiBaseUrl)
      .then((value) => live && setResult(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload]);
  if (error) return <ErrorState message={error} />;
  if (!result) return <Loading text="Loading dashboard…" />;
  const jobs = result.jobCounts.total,
    activeJobs = result.jobCounts.active,
    resumes = result.resumeCounts.total,
    activeResumes = result.resumeCounts.active,
    recentJ = result.recentJobs,
    recentR = result.recentResumes || [],
    showApplierPerformance = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE);
  return (
    <div className="page">
      <Title level={1} tabIndex={-1}>
        Overview
      </Title>
      <Row gutter={[16, 16]} className="summary-grid">
        {[
          ["Total Job Descriptions", jobs],
          ["Active Job Descriptions", activeJobs],
          ["Total Resumes", resumes],
          ["Active Resumes", activeResumes],
        ].map(([label, count]) => (
          <Col xs={24} sm={12} xl={6} key={label}>
            <Card>
              <Statistic title={label} value={count} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card
        title="Recent job descriptions"
        extra={<a href="#/jobs">View all</a>}
      >
        {recentJ.length ? (
          <Table
            headers={[
              "Company",
              "Job title",
              "Category",
              "Captured by",
              "Status",
              "Captured",
            ]}
          >
            {recentJ.map((job) => (
              <tr key={job.id}>
                <td>{job.company}</td>
                <td>
                  <a href={`#/jobs/${job.id}`}>{job.job_title}</a>
                </td>
                <td>{categoryName(categories, job.category_id)}</td>
                <td>{capturedBy(job)}</td>
                <td>
                  <Badge value={job.status} />
                </td>
                <td>{formatDate(job.created_at)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Text type="secondary">
            No job descriptions have been captured yet.
          </Text>
        )}
      </Card>
      {showApplierPerformance ? <ApplierPerformanceChart rows={result.applierPerformance || []}/> : <Card title="Recent resumes" extra={<a href="#/resumes">View all</a>}>
        {recentR.length ? (
          <Table
            headers={["Candidate", "Resume", "Category", "Status", "Updated"]}
          >
            {recentR.map((resume) => (
              <tr key={resume.id}>
                <td>{resume.candidate_name}</td>
                <td>
                  <a href={`#/resumes/${resume.id}`}>{resume.resume_name}</a>
                </td>
                <td>{categoryName(categories, resume.primary_category_id)}</td>
                <td>
                  <Badge value={resume.status} />
                </td>
                <td>{formatDate(resume.updated_at)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Text type="secondary">No resumes have been uploaded yet.</Text>
        )}
      </Card>}
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
  const filters = parseJobQuery(query),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [capturers, setCapturers] = useState([]),
    [capturersLoading, setCapturersLoading] = useState(true),
    [capturerError, setCapturerError] = useState(""),
    canBulk = hasCapability(access, CAPABILITIES.APPLICATION_BULK_MANAGE);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    listJobs(client, apiBaseUrl, filters)
      .then((value) => live && setData(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, query, reload]);
  useEffect(() => {
    let live = true;
    setCapturersLoading(true);
    setCapturerError("");
    listJobCapturers(client, apiBaseUrl)
      .then((value) => live && setCapturers(value))
      .catch((value) => live && setCapturerError(value.message))
      .finally(() => live && setCapturersLoading(false));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload]);
  const update = (patch) => {
    const value = serializeQuery({ ...filters, ...patch });
    go(`#/jobs${value ? `?${value}` : ""}`);
  };
  const columns = useMemo(
    () =>
      serverSortColumns(
        [
          { title: "Company", dataIndex: "company", sortKey: "company" },
          { title: "Job title", dataIndex: "job_title", sortKey: "title" },
          {
            title: "Primary category",
            dataIndex: "category_id",
            sortKey: "category",
            render: (value) => categoryName(categories, value),
          },
          {
            title: "Job Posting URL",
            dataIndex: "source_url",
            sortKey: "source",
            width: 520,
            render: (value) => {
              const source = safeExternalUrl(value);
              return source ? <a href={source} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{value}</a> : "—";
            },
          },
          {
            title: "Captured by",
            key: "captured_by",
            sortKey: "capturer",
            render: (_, job) => capturedBy(job),
          },
          {
            title: "Status",
            dataIndex: "status",
            sortKey: "status",
            render: (value) => <Badge value={value} />,
          },
          {
            title: "Captured",
            dataIndex: "created_at",
            sortKey: "created",
            render: formatDate,
          },
          {
            title: "",
            key: "action",
            render: (_, job) => <a href={`#/jobs/${job.id}`}>View</a>,
          },
        ],
        filters.sort,
      ),
    [categories, filters.sort],
  );
  const selectedCount = selectedJobIds.length,
    tooMany = selectedCount > MAX_BULK_JDS;
  return (
    <div className="page">
      <Flex justify="space-between" align="center" wrap>
        <Title level={1} tabIndex={-1}>
          Job Descriptions
        </Title>
        {canBulk && (
          <Space>
            <Text>{selectedCount} selected</Text>
            <Button
              onClick={() => onSelectedJobIdsChange([])}
              disabled={!selectedCount}
            >
              Clear selection
            </Button>
            <Button
              type="primary"
              disabled={!selectedCount || tooMany}
              onClick={() => go("#/applications/bulk-create")}
            >
              Create Applications
            </Button>
          </Space>
        )}
      </Flex>
      {tooMany && (
        <Alert
          type="error"
          showIcon
          message={`Select no more than ${MAX_BULK_JDS} job descriptions.`}
        />
      )}
      <FilterForm
        kind="jobs"
        value={filters}
        categories={categories}
        capturers={capturers}
        capturersLoading={capturersLoading}
        onApply={update}
        onClear={() => go("#/jobs")}
      />
      {capturerError && (
        <Alert
          type="warning"
          showIcon
          message="Captured-by options could not be loaded."
          description={capturerError}
        />
      )}
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading text="Loading job descriptions…" />
      ) : !data.items.length ? (
        <Empty
          title="No job descriptions"
          text="No job descriptions match the current view."
          onClear={() => go("#/jobs")}
        />
      ) : (
        <Card>
          <AntTable
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
            onChange={(_pagination, _tableFilters, sorter) =>
              update({
                sort: serverSortFromTable(sorter, "created_desc"),
                page: 1,
              })
            }
            rowSelection={
              canBulk
                ? {
                    selectedRowKeys: selectedJobIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => onSelectedJobIdsChange(keys),
                    getCheckboxProps: (job) => ({ disabled: job.status !== "ACTIVE", title: job.status !== "ACTIVE" ? "Restore this URL before creating an Application." : undefined }),
                  }
                : undefined
            }
          />
          <Pagination data={data} onPage={(page) => update({ page })} />
        </Card>
      )}
    </div>
  );
}

function Resumes({ client, apiBaseUrl, categories, query, reload, access }) {
  const filters = parseResumeQuery(query),
    [data, setData] = useState(null),
    [error, setError] = useState("");
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
  const update = (patch) => {
      const value = serializeQuery({ ...filters, ...patch });
      go(`#/resumes${value ? `?${value}` : ""}`);
    },
    columns = useMemo(
      () =>
        serverSortColumns(
          [
            {
              title: "Resume #",
              dataIndex: "resume_number",
              sortKey: "number",
              render: (value) => (value ? `#${value}` : "—"),
            },
            {
              title: "Candidate",
              dataIndex: "candidate_name",
              sortKey: "candidate",
            },
            { title: "Resume", dataIndex: "resume_name", sortKey: "name" },
            {
              title: "Primary category",
              dataIndex: "primary_category_id",
              sortKey: "category",
              render: (value) => categoryName(categories, value),
            },
            {
              title: "Subcategory",
              dataIndex: "subcategory_id",
              sortKey: "subcategory",
              render: (value) =>
                value ? categoryName(categories, value) : "None",
            },
            {
              title: "Seniority",
              dataIndex: "seniority",
              sortKey: "seniority",
              render: formatLabel,
            },
            {
              title: "File type",
              dataIndex: "mime_type",
              sortKey: "mime",
              render: formatMime,
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
              render: (value) => <Badge value={value} />,
            },
            {
              title: "",
              key: "action",
              render: (_, resume) => (
                <Space>
                  <a href={`#/resumes/${resume.id}`}>View</a>
                  {hasCapability(access, CAPABILITIES.APPLICATION_MANAGE) && (
                    <Text type="secondary">{resume.status === "ARCHIVED" ? "History" : "Current"}</Text>
                  )}
                </Space>
              ),
            },
          ],
          filters.sort,
        ),
      [access, categories, filters.sort],
    );
  return (
    <div className="page">
      <Title level={1} tabIndex={-1}>
        Resumes
      </Title>
      <FilterForm
        kind="resumes"
        value={filters}
        categories={categories}
        onApply={update}
        onClear={() => go("#/resumes")}
      />
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading text="Loading resumes…" />
      ) : !data.items.length ? (
        <Empty
          title="No resumes"
          text={filters.status === "ARCHIVED" ? "No archived Resume history matches the current filters." : "No active Resumes match the current filters."}
          onClear={() => go("#/resumes")}
        />
      ) : (
        <Card>
          <AntTable
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
            onChange={(_pagination, _tableFilters, sorter) =>
              update({
                sort: serverSortFromTable(sorter, "updated_desc"),
                page: 1,
              })
            }
          />
          <Pagination data={data} onPage={(page) => update({ page })} />
        </Card>
      )}
    </div>
  );
}

function JobDetail({ client, apiBaseUrl, categories, id, back, reload, access }) {
  const [job, setJob] = useState(),
    [error, setError] = useState(""),
    [statusMessage, setStatusMessage] = useState(""),
    [statusBusy, setStatusBusy] = useState(false);
  useEffect(() => {
    getJob(client, apiBaseUrl, id)
      .then(setJob)
      .catch((value) => setError(value.message));
  }, [client, apiBaseUrl, id, reload]);
  if (error) return <ErrorState message={error} />;
  if (job === undefined) return <Loading />;
  if (!job)
    return (
      <ErrorState message="Job description not found or you do not have access to it." />
    );
  const source = safeExternalUrl(job.source_url),
    tabs = [
      {
        key: "overview",
        label: "Overview",
        children: (
          <Meta
            items={[
              ["Primary category", categoryName(categories, job.category_id)],
              [
                "Subcategory",
                job.subcategory_id
                  ? categoryName(categories, job.subcategory_id)
                  : "None",
              ],
              ["Industry domain", formatLabel(job.industry_domain)],
              ["Seniority", formatLabel(job.seniority)],
              ["Location", job.location_text || "Not specified / remote"],
              ["Work arrangement", formatLabel(job.work_arrangement)],
              ["Salary range", salaryRange(job)],
              ["Original salary text", job.salary_text || "—"],
              [
                "Travel required",
                job.travel_required === null
                  ? "Not specified"
                  : job.travel_required
                    ? "Yes"
                    : "No",
              ],
              ["Travel details", job.travel_details || "—"],
              ["Source site", job.source_site],
              ["Captured by", capturedBy(job)],
              ["Capturer user ID", job.user_id],
              ["Capture method", formatLabel(job.capture_method)],
              ["Extraction confidence", formatLabel(job.extraction_confidence)],
              ["Captured at", formatDate(job.created_at)],
              ["Last updated", formatDate(job.updated_at)],
              ...(job.status === "ARCHIVED" ? [
                ["Declined / archived at", formatDate(job.archived_at)],
                ["Reviewed by user ID", job.archived_by || "Not recorded"],
                ["Review reason", formatLabel(job.archive_reason)],
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
            <Card size="small" title="Security requirements">
              <Tags
                values={job.clearance_requirements?.map(formatLabel)}
                empty="No clearance requirement detected"
              />
            </Card>
            <Card size="small" title="Detected technology stack">
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
        label: "Job description",
        children: <div className="long-text">{job.description_text}</div>,
      },
    ];
  async function changeStatus(status) {
    setStatusBusy(true);
    setStatusMessage("");
    try {
      const next = await setJobStatus(client, apiBaseUrl, job.id, status, status === "ARCHIVED" ? "NOT_APPLICABLE" : undefined);
      setJob((current) => ({ ...current, ...next }));
      setStatusMessage(status === "ARCHIVED" ? "URL declined and archived. Its capture history remains, and it is excluded from new Applications." : "URL restored to active review and new Application workflows.");
    } catch (value) {
      setStatusMessage(value.message);
    } finally {
      setStatusBusy(false);
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
        <Badge value={job.status} />
      </div>
      {statusMessage && <Alert type="info" showIcon message={statusMessage} />}
      <TabbedSections
        items={tabs}
        extra={
          <Space wrap align="center" className="detail-action-group">
            {source ? <Button type="link" href={source} target="_blank" rel="noopener noreferrer">Open original posting</Button> : null}
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
    </div>
  );
}

function ResumeDetail({ client, apiBaseUrl, categories, id, back, reload, access }) {
  const [resume, setResume] = useState(),
    [error, setError] = useState(""),
    [fileMessage, setFileMessage] = useState(""),
    [statusMessage, setStatusMessage] = useState(""),
    [statusBusy, setStatusBusy] = useState(false);
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
  async function open() {
    setFileMessage("Generating a secure link…");
    try {
      const url = await createResumeSignedUrl(client, {id:resume.id,apiBaseUrl});
      window.open(url, "_blank", "noopener,noreferrer");
      setFileMessage("Secure link opened. It expires shortly.");
    } catch (value) {
      setFileMessage(value.message);
    }
  }
  async function changeStatus(status) {
    setStatusBusy(true);
    setStatusMessage("");
    try {
      const next = await setResumeStatus(client, apiBaseUrl, resume.id, status);
      setResume((current) => ({ ...current, ...next }));
      setStatusMessage(status === "ARCHIVED" ? "Resume archived. It is now retained as history and excluded from new work." : "Resume restored and available for new work.");
    } catch (value) {
      setStatusMessage(value.message);
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
                ["Resume number", resume.resume_number ? `#${resume.resume_number}` : "Not assigned"],
                ["Resume type", formatLabel(resume.resume_type || "ORIGINAL")],
                ["Parent Resume", resume.parent_resume_id ? "Original Resume available from this Application's tailoring history" : "None — this is an original Resume"],
                ["Candidate email", resume.candidate_email || "Not recorded"],
                ["Candidate phone", resume.candidate_phone || "Not recorded"],
                ["Autofill metadata", formatLabel(resume.profile_review_status)],
                ["Metadata reviewed at", formatDate(resume.profile_reviewed_at)],
                [
                  "Primary category",
                  categoryName(categories, resume.primary_category_id),
                ],
                [
                  "Subcategory",
                  resume.subcategory_id
                    ? categoryName(categories, resume.subcategory_id)
                    : "None",
                ],
                ["Seniority", formatLabel(resume.seniority)],
                [
                  "Structured schema version",
                  resume.structured_schema_version || "Legacy",
                ],
                ["Original filename", resume.original_filename],
                ["File type", formatMime(resume.mime_type)],
                ["File size", formatBytes(resume.file_size_bytes)],
                ["Created at", formatDate(resume.created_at)],
                ["Last updated", formatDate(resume.updated_at)],
                ...(resume.status === "ARCHIVED" ? [
                  ["Archived at", formatDate(resume.archived_at)],
                  ["Archived by user ID", resume.archived_by || "Not recorded"],
                ] : []),
              ]}
            />
            <Card size="small" title="Skills">
              <Tags values={resume.skills} empty="No skills recorded" />
            </Card>
            <Card size="small" title="Industries">
              <Tags values={resume.industries} empty="No industries recorded" />
            </Card>
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
        label: "Original text",
        children: <div className="long-text">{resume.resume_text}</div>,
      },
      ...(hasCapability(access,CAPABILITIES.APPLICATION_MANAGE)?[{
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
      {fileMessage && <Alert type="info" showIcon message={fileMessage} />}
      {statusMessage && <Alert type="info" showIcon message={statusMessage} />}
      <TabbedSections
        items={tabs}
        extra={
          <Space wrap align="center" className="detail-action-group">
            <Button type="primary" onClick={open}>Open Original Resume</Button>
            {hasCapability(access,CAPABILITIES.APPLICATION_MANAGE)&&resume.status==="ACTIVE"&&<Button href={`#/resumes/${resume.id}/autofill`}>Edit Structured Resume</Button>}
            {hasCapability(access,CAPABILITIES.APPLICATION_MANAGE)&&resume.resume_type==="ORIGINAL"&&(
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
          title="Dashboard setup required"
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
    [access, setAccess] = useState(undefined),
    [accessError, setAccessError] = useState(null),
    [route, setRoute] = useState(() => parseRoute(location.hash || "#/")),
    [categories, setCategories] = useState(null),
    [roles, setRoles] = useState([]),
    [selectedBulkJobIds, setSelectedBulkJobIds] = useState([]),
    [reload, setReload] = useState(0),
    sessionRef = useRef(undefined),
    jobsBack = useRef("#/jobs"),
    resumesBack = useRef("#/resumes");
  const reloadAccess = useCallback(async () => {
    if (!session) return;
    setAccessError(null);
    try {
      const next = await getMyAccessContext(client, apiBaseUrl);
      setAccess(next);
      return next;
    } catch (error) {
      setAccess(null);
      setAccessError(error);
    }
  }, [client, apiBaseUrl, session]);
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
    if (session) reloadAccess();
    else {
      setAccess(undefined);
      setCategories(null);
      setRoles([]);
    }
  }, [session, reloadAccess]);
  useEffect(() => {
    let live = true;
    if (
      access &&
      hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ) &&
      !categories
    )
      loadCategories(client, apiBaseUrl)
        .then((value) => live && setCategories(value))
        .catch(setAccessError);
    if (access && !hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ))
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
  if (!session)
    return (
      <Login
        client={client}
        onSignedIn={(next) => {
          setSession(next);
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
        title="Access error"
        access={{ email: session.user.email, status: "INACTIVE", roles: [] }}
        logout={logout}
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
      >
        <AccessDeniedPage />
      </Shell>
    );
  const needsCategories =
    hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ) &&
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
      <>
        <div className="page application-overview">
          <ApplicationCountCards
            client={client}
            apiBaseUrl={apiBaseUrl}
            access={access}
            reload={reload}
          />
        </div>
        <BusinessOverview
          client={client}
          apiBaseUrl={apiBaseUrl}
          categories={categories}
          reload={reload}
          access={access}
        />
      </>
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
  else if (route.name === "tailoring-jobs")
    page = <TailoringQueuePage client={client} apiBaseUrl={apiBaseUrl} reload={reload} />;
  else if (route.name === "tailoring-job-detail")
    page = <TailoringReviewPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} reload={reload} />;
  else if (route.name === "tailoring-batches")
    page = <TailoringBatchesPage client={client} apiBaseUrl={apiBaseUrl} />;
  else if (route.name === "tailoring-batch-detail")
    page = <TailoringBatchDetailPage client={client} apiBaseUrl={apiBaseUrl} id={route.id} />;
  else if (route.name === "users-directory")
    page = <ApplierDirectoryPage client={client} apiBaseUrl={apiBaseUrl} reload={reload} />;
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
    page = <AdminUsersPage client={client} apiBaseUrl={apiBaseUrl} roles={roles} reload={reload} />;
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
      refresh={() => setReload((value) => value + 1)}
      logout={logout}
    >
      {page}
    </Shell>
  );
}
