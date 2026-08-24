import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Avatar,
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
import { getSession, signIn, signOut } from "./services/auth-service.js";
import { authStateDecision } from "./services/auth-state.js";
import { categoryName, loadCategories } from "./services/category-service.js";
import { getJob, listJobCapturers, listJobs, reviewJob, setJobStatus, updateOwnJob } from "./services/job-read-service.js";
import { exportFilteredJobsExcel } from "./services/job-export-service.js";
import { getResume, listResumes, setResumeStatus } from "./services/resume-read-service.js";
import {
  addResumeBannedCompany,
  listResumeBannedCompanies,
  removeResumeBannedCompany,
} from "./services/resume-banned-companies-service.js";
import { getBusinessOverview } from "./services/business-overview-service.js";
import { ApplierPerformanceChart } from "./features/overview/applier-performance-chart.jsx";
import { JdFinderPerformanceChart } from "./features/overview/jd-finder-performance-chart.jsx";
import { OverviewDateFilter } from "./features/overview/overview-date-filter.jsx";
import { DEFAULT_OVERVIEW_WINDOW, overviewDateBounds } from "./features/overview/overview-date.js";
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
import { normalizeSearch, validateLogin } from "./shared/validation.js";
import { safeExternalUrl } from "./shared/url.js";
import {
  MIME_TYPES,
  PAGE_SIZES,
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
const personInitials = (name) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};
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

function Shell({ route, title, access, logout, headerExtra, children }) {
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
    headerInitials = personInitials(headerName),
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
          <Space wrap className="dashboard-header-actions" align="center">
            {headerExtra}
            <Tooltip title={access?.email || undefined}>
              <Space align="center" size="small" className="user-identity">
                <Avatar
                  className="user-avatar"
                  size={36}
                  style={{ backgroundColor: "#1677ff", flex: "none" }}
                >
                  {headerInitials}
                </Avatar>
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
        {message && <UiErrorState title="Sign In Failed" message={message} />}
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

function BusinessOverview({ client, apiBaseUrl, categories, reload, access, dateRange, dateLabel }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setResult(null);
    setError("");
    getBusinessOverview(client, apiBaseUrl, dateRange)
      .then((value) => live && setResult(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload, dateRange?.from, dateRange?.to]);
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
      <Title level={2}>
        Business Records
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
      {!showApplierPerformance && <Card
        title="Recent Job Descriptions"
        extra={<a href="#/jobs">View all</a>}
      >
        {recentJ.length ? (
          <Table
            headers={[
              "Company",
              "Job Title",
              "Category",
              "Captured By",
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
      </Card>}
      {showApplierPerformance ? <Row gutter={[16,16]}><Col xs={24} xl={12}><ApplierPerformanceChart rows={result.applierPerformance || []} dateLabel={dateLabel}/></Col><Col xs={24} xl={12}><JdFinderPerformanceChart rows={result.jdFinderPerformance || []} dateLabel={dateLabel}/></Col></Row> : <Card title="Recent Resumes" extra={<a href="#/resumes">View all</a>}>
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

function BusinessDashboard({ client, apiBaseUrl, categories, reload, access, period, dateRange }) {
  return (
    <>
      <div className="page application-overview">
        <Title level={1} tabIndex={-1}>Overview</Title>
        <ApplicationCountCards client={client} apiBaseUrl={apiBaseUrl} access={access} reload={reload} dateRange={dateRange} dateLabel={period.label} />
      </div>
      <BusinessOverview client={client} apiBaseUrl={apiBaseUrl} categories={categories} reload={reload} access={access} dateRange={dateRange} dateLabel={period.label} />
    </>
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
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [exportBusy, setExportBusy] = useState(false),
    [exportMessage, setExportMessage] = useState(""),
    [capturers, setCapturers] = useState([]),
    [capturerError, setCapturerError] = useState(""),
    canBulk = hasCapability(access, CAPABILITIES.APPLICATION_BULK_MANAGE);
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
  }, [client, apiBaseUrl, query, reload]);
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
    jobsTableScrollX = 1580;
  async function downloadExcel() {
    setExportBusy(true);
    setExportMessage("");
    try {
      await exportFilteredJobsExcel(client, apiBaseUrl, filters);
    } catch (value) {
      setExportMessage(value.message || "Job Descriptions could not be exported.");
    } finally {
      setExportBusy(false);
    }
  }
  return (
    <div className="page">
      <Flex className="page-toolbar" justify="flex-end" align="center" wrap>
        <Space wrap>
          <Button
            loading={exportBusy}
            disabled={!data?.total || loading}
            onClick={downloadExcel}
          >
            Download Excel
          </Button>
          {canBulk && (
            <>
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
            </>
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
      {exportMessage && (
        <Alert type="error" showIcon message={exportMessage} />
      )}
      {capturerError && (
        <Alert
          type="warning"
          showIcon
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
        <Card>
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 12 }}
            />
          )}
          <AntTable
            className="dashboard-ellipsis-table"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={data.items}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: jobsTableScrollX, y: "calc(100vh - 240px)" }}
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
              canBulk
                ? {
                    columnWidth: 48,
                    fixed: true,
                    selectedRowKeys: selectedJobIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => onSelectedJobIdsChange(keys),
                    getCheckboxProps: (job) => ({
                      disabled:
                        job.status !== "ACTIVE" ||
                        job.review_status !== "APPROVED",
                      title:
                        job.review_status !== "APPROVED"
                          ? "Approve this JD before creating an Application."
                          : job.status !== "ACTIVE"
                            ? "Restore this URL before creating an Application."
                            : undefined,
                    }),
                  }
                : undefined
            }
          />
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
  const filters = parseResumeQuery(query),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [coverMessage, setCoverMessage] = useState(""),
    [coverBusyId, setCoverBusyId] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setCoverMessage("");
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
    setCoverMessage("");
    try {
      const url = await createCoverLetterSignedUrl(client, { id: resume.id, apiBaseUrl });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (value) {
      setCoverMessage(value.message);
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
              title: "Resume #",
              dataIndex: "resume_number",
              sortKey: "number",
              render: (value) => (value ? `#${value}` : "—"),
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
        filters.search,
        filters.seniority,
        filters.sort,
        filters.status,
        searchFiltered,
      ],
    );
  return (
    <div className="page">
      {coverMessage && <Alert type="error" showIcon message={coverMessage} style={{ marginBottom: 16 }} />}
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading text="Loading resumes…" />
      ) : (
        <Card>
          <AntTable
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            pagination={false}
            scroll={{ x: "max-content", y: "calc(100vh - 240px)" }}
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
  const [editForm] = Form.useForm();
  const [job, setJob] = useState(),
    [error, setError] = useState(""),
    [statusMessage, setStatusMessage] = useState(""),
    [statusMessageType, setStatusMessageType] = useState("info"),
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
    setStatusMessage("");
    try {
      const next = await setJobStatus(client, apiBaseUrl, job.id, status, status === "ARCHIVED" ? "NOT_APPLICABLE" : undefined);
      setJob((current) => ({ ...current, ...next }));
      setStatusMessageType("success");
      setStatusMessage(status === "ARCHIVED" ? "URL declined and archived. Its capture history remains, and it is excluded from new Applications." : "URL restored to active review and new Application Workflows.");
    } catch (value) {
      setStatusMessageType("error");
      setStatusMessage(value.message);
    } finally {
      setStatusBusy(false);
    }
  }
  async function submitReview(nextStatus, reason = null, comment = "") {
    setReviewBusy(true);
    setStatusMessage("");
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
      setStatusMessageType("success");
      setStatusMessage(
        nextStatus === "APPROVED"
          ? "JD approved. It can be selected for new Applications."
          : nextStatus === "DECLINED"
            ? "JD declined in review."
            : nextStatus === "NEEDS_CORRECTION"
              ? "Correction requested from the JD Finder."
              : "Review Status updated.",
      );
    } catch (value) {
      setStatusMessageType("error");
      setStatusMessage(value.message);
    } finally {
      setReviewBusy(false);
    }
  }
  const finderCanEdit = hasCapability(access, CAPABILITIES.JOB_DESCRIPTION_EDIT_OWN) && job.user_id === access.userId && ["NEEDS_REVIEW", "NEEDS_CORRECTION"].includes(job.review_status);
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
      const next = await updateOwnJob(client, apiBaseUrl, job.id, {
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
      });
      setJob((current) => ({ ...current, ...next }));
      setEditOpen(false);
      setStatusMessageType("success");
      setStatusMessage(job.review_status === "NEEDS_CORRECTION" ? "Correction saved. The JD remains in Needs Correction until a manager reviews it again." : "Changes saved. The JD remains in the review queue.");
    } catch (value) {
      if (value?.errorFields) return;
      setStatusMessageType("error");
      setStatusMessage(value?.message || "The correction could not be saved.");
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
      {statusMessage && <Alert type={statusMessageType} showIcon message={statusMessage} />}
      <TabbedSections
        items={tabs}
        extra={
          <Space wrap align="center" className="detail-action-group">
            {source ? <Button type="link" href={source} target="_blank" rel="noopener noreferrer">Open original posting</Button> : null}
            {finderCanEdit && <Button type="primary" onClick={openEdit}>Edit my JD</Button>}
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
      <Modal open={editOpen} title="Edit Captured Job Description" width={760} okText="Save Changes" confirmLoading={editBusy} onOk={saveEdit} onCancel={() => !editBusy && setEditOpen(false)}>
        <Alert type="info" showIcon message={job.review_status === "NEEDS_CORRECTION" ? "Correct the requested details. The manager's review comment and audit history will be preserved." : "You can edit this JD until it is approved or declined."} style={{ marginBottom: 16 }} />
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
  const [resume, setResume] = useState(),
    [error, setError] = useState(""),
    [fileMessage, setFileMessage] = useState(""),
    [statusMessage, setStatusMessage] = useState(""),
    [statusBusy, setStatusBusy] = useState(false),
    [coverBusy, setCoverBusy] = useState(false),
    coverInputRef = useRef(null);
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
    hasCoverLetter = Boolean(resume.cover_letter_storage_path);
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
  async function openCoverLetter() {
    setFileMessage("Generating a secure cover letter link…");
    try {
      const url = await createCoverLetterSignedUrl(client, { id: resume.id, apiBaseUrl });
      window.open(url, "_blank", "noopener,noreferrer");
      setFileMessage("Cover Letter link opened. It expires shortly.");
    } catch (value) {
      setFileMessage(value.message);
    }
  }
  async function onCoverLetterSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCoverBusy(true);
    setFileMessage("");
    try {
      const next = await uploadResumeCoverLetter(client, { id: resume.id, apiBaseUrl, file });
      setResume((current) => ({ ...current, ...next }));
      setFileMessage(hasCoverLetter ? "Cover Letter replaced." : "Cover Letter uploaded.");
    } catch (value) {
      setFileMessage(value.message);
    } finally {
      setCoverBusy(false);
    }
  }
  async function removeCoverLetter() {
    setCoverBusy(true);
    setFileMessage("");
    try {
      const next = await removeResumeCoverLetter(client, { id: resume.id, apiBaseUrl });
      setResume((current) => ({ ...current, ...next }));
      setFileMessage("Cover Letter removed.");
    } catch (value) {
      setFileMessage(value.message);
    } finally {
      setCoverBusy(false);
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
                ["Resume Number", resume.resume_number ? `#${resume.resume_number}` : "Not assigned"],
                ["Resume Type", formatLabel(resume.resume_type || "ORIGINAL")],
                ["Parent Resume", resume.parent_resume_id ? "Original Resume available from this Application's tailoring history" : "None — this is an original Resume"],
                ["Candidate Email", resume.candidate_email || "Not recorded"],
                ["Candidate Phone", resume.candidate_phone || "Not recorded"],
                ["Autofill Metadata", formatLabel(resume.profile_review_status)],
                ["Metadata Reviewed At", formatDate(resume.profile_reviewed_at)],
                [
                  "Primary Category",
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
      {fileMessage && <Alert type="info" showIcon message={fileMessage} />}
      {statusMessage && <Alert type="info" showIcon message={statusMessage} />}
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
        title="Access Error"
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
      <BusinessDashboard client={client} apiBaseUrl={apiBaseUrl} categories={categories} reload={reload} access={access} period={overviewPeriod} dateRange={overviewDateRange} />
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
      headerExtra={route.name === "overview" && hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ) ? <OverviewDateFilter compact value={overviewPeriod} onChange={setOverviewPeriod} /> : null}
    >
      {page}
    </Shell>
  );
}
