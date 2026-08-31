import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Flex,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { AccountStatusBadge } from "../../components/access-components.jsx";
import { ErrorState, LoadingState } from "../../components/ui.jsx";
import { UserAvatar } from "../../components/user-avatar.jsx";
import { ApplierProfileWorkloadChart } from "../overview/applier-profile-workload-chart.jsx";
import { OverviewDateFilter } from "../overview/overview-date-filter.jsx";
import {
  DEFAULT_OVERVIEW_WINDOW,
  overviewDateBounds,
} from "../overview/overview-date.js";
import {
  ProductivityScoreBadge,
  ProductivityStatusTag,
} from "../overview/applier-productivity-table.jsx";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "../overview/overview-ui.jsx";
import { formatDate, formatLabel } from "../../shared/formatters.js";
import {
  activityLogActionColor,
  formatActivityLogDetail,
} from "../../services/activity-log-ui.js";
import { loadApplierActivity, loadApplierDetail } from "./applier-detail-service.js";

const { Text, Title } = Typography;

function profileLabel(row) {
  const name = row.resumeName || row.candidateName || row.resume_name || row.candidate_name || "Resume";
  const candidate =
    (row.candidateName || row.candidate_name) &&
    (row.resumeName || row.resume_name) &&
    (row.candidateName || row.candidate_name) !== (row.resumeName || row.resume_name)
      ? ` · ${row.candidateName || row.candidate_name}`
      : "";
  const number = row.resumeNumber != null || row.resume_number != null
    ? ` #${row.resumeNumber ?? row.resume_number}`
    : "";
  return `${name}${candidate}${number}`;
}

export function ApplierDetailPage({ client, apiBaseUrl, id }) {
  const [period, setPeriod] = useState(DEFAULT_OVERVIEW_WINDOW);
  const [payload, setPayload] = useState(null);
  const [activityItems, setActivityItems] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => overviewDateBounds(period), [period]);
  const productivity = payload?.productivity;

  useEffect(() => {
    let active = true;
    if (!range) {
      setError("Select a valid reporting period.");
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError("");
    loadApplierDetail(client, apiBaseUrl, id, range)
      .then((value) => {
        if (!active) return;
        setPayload(value);
        setActivityItems(value.activity || []);
        setActivityTotal(value.activityTotal || 0);
        setActivityPage(value.activityPage || 1);
        setLoading(false);
      })
      .catch((value) => {
        if (!active) return;
        setPayload(null);
        setError(value.message || "The Applier scorecard could not be loaded.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, client, id, range]);

  const activityHasMore = activityItems.length < activityTotal;

  async function loadMoreActivity() {
    if (!range || activityLoading || !activityHasMore) return;
    setActivityLoading(true);
    try {
      const nextPage = activityPage + 1;
      const result = await loadApplierActivity(client, apiBaseUrl, id, range, nextPage);
      setActivityItems((current) => [...current, ...(result.items || [])]);
      setActivityTotal(result.total || activityTotal);
      setActivityPage(nextPage);
    } catch (value) {
      setError(value.message || "More activity could not be loaded.");
    } finally {
      setActivityLoading(false);
    }
  }

  const activityColumns = [
    {
      title: "Time",
      dataIndex: "occurred_at",
      width: 170,
      render: (value) => formatDate(value),
    },
    {
      title: "Action",
      dataIndex: "action_label",
      width: 200,
      render: (value, record) => (
        <Tag color={activityLogActionColor(record.action)}>
          {value || formatLabel(record.action)}
        </Tag>
      ),
    },
    {
      title: "Details",
      key: "detail",
      ellipsis: true,
      render: (_, record) => formatActivityLogDetail(record) || "—",
    },
    {
      title: "Job Title",
      dataIndex: "job_title",
      width: 180,
      ellipsis: true,
      render: (value, record) =>
        value ? (
          <span title={record.company ? `${value} — ${record.company}` : value}>
            {value}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "Application",
      dataIndex: "application_number",
      width: 120,
      render: (value, record) =>
        record.application_id ? (
          <Button type="link" href={`#/applications/${record.application_id}`} style={{ padding: 0 }}>
            {value ? `#${value}` : "Open"}
          </Button>
        ) : (
          "—"
        ),
    },
  ];

  if (loading && !payload) {
    return (
      <div className="page">
        <LoadingState text="Loading Applier scorecard…" />
      </div>
    );
  }

  if (error && !productivity) {
    return (
      <div className="page">
        <Button type="link" href="#/" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }}>
          Back to Overview
        </Button>
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="page applier-detail-page">
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={16}>
        <Space direction="vertical" size={12}>
          <Button type="link" href="#/" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }}>
            Back to Overview
          </Button>
          <div className="applier-detail-header">
            <div className="applier-detail-identity">
              <UserAvatar
                client={client}
                apiBaseUrl={apiBaseUrl}
                userId={productivity.id}
                name={productivity.name}
                size={64}
              />
              <div className="applier-detail-meta">
                <Title level={2} style={{ margin: 0 }}>
                  {productivity.name}
                </Title>
                {productivity.email ? <Text type="secondary">{productivity.email}</Text> : null}
                <div className="applier-detail-badges">
                  <AccountStatusBadge status={productivity.profileStatus} />
                  <ProductivityStatusTag status={productivity.productivityStatus} />
                  <ProductivityScoreBadge
                    score={productivity.score}
                    tone={productivity.scoreTone}
                    grade={productivity.grade}
                  />
                  <Text type="secondary" className="applier-detail-grade-note">
                    {productivity.gradeLabel} · score {productivity.score}
                  </Text>
                </div>
              </div>
            </div>
          </div>
        </Space>
        <OverviewDateFilter compact value={period} onChange={setPeriod} />
      </Flex>

      <div className="applier-detail-actions">
        <Button href={`#/applications?assignedTo=${encodeURIComponent(id)}`}>
          View Applications
        </Button>
        <Button href={`#/admin/users/${encodeURIComponent(id)}`}>Admin User</Button>
        <Button href="#/applier-directory">Manage Profiles</Button>
      </div>

      <OverviewSection
        title="Scorecard"
        description={`Performance for ${period.label.toLowerCase()}.`}
      >
        <OverviewKpiGrid columns={3}>
          {[
            {
              key: "grade",
              tone:
                productivity.scoreTone === "high"
                  ? "green"
                  : productivity.scoreTone === "medium"
                    ? "orange"
                    : "blue",
              icon: <TrophyOutlined />,
              value: productivity.grade,
              label: "Performance Grade",
              meta: `${productivity.gradeLabel} · score ${productivity.score}`,
            },
            {
              key: "applied",
              tone: "purple",
              icon: <ThunderboltOutlined />,
              value: productivity.applied,
              label: "Applications",
              meta: `${productivity.assigned} assigned · ${productivity.completed} completed`,
            },
            {
              key: "avg",
              tone: "orange",
              icon: <TrophyOutlined />,
              value: productivity.avgPerDay.toFixed(1),
              label: "Avg / Day",
              meta: `${productivity.activeDays} active days`,
            },
            {
              key: "success",
              tone: "teal",
              icon: <CheckCircleOutlined />,
              value: `${Number(productivity.completionRate).toFixed(1)}%`,
              label: "Success Rate",
              meta: "Completion in period",
            },
            {
              key: "days",
              tone: "blue",
              icon: <ClockCircleOutlined />,
              value: `${productivity.activeDays} / ${productivity.windowDays}`,
              label: "Active Days",
              meta: "Days with activity",
            },
            {
              key: "blocked",
              tone: "green",
              icon: <StopOutlined />,
              value: productivity.blocked,
              label: "Blocked",
              meta: "Applications blocked",
            },
            {
              key: "last",
              tone: "blue",
              icon: <ClockCircleOutlined />,
              value: productivity.lastActivityLabel,
              label: "Last Activity",
              meta: "Most recent event",
            },
          ].map((card) => (
            <OverviewKpiCard key={card.key} {...card} />
          ))}
        </OverviewKpiGrid>
      </OverviewSection>

      <ApplierProfileWorkloadChart
        rows={payload.profileWorkload}
        dateLabel={period.label}
        title="Profile Workload"
        emptyDescription="No Resume profiles are mapped to this Applier."
      />

      <div className="applier-detail-grid">
        <Card title="Workload Settings">
          {payload.workloadSettings ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Availability">
                <Tag color={payload.workloadSettings.isAvailable ? "success" : "default"}>
                  {payload.workloadSettings.isAvailable ? "Available" : "Unavailable"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Active Applications">
                {payload.workloadSettings.activeApplicationCount ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Max Active Applications">
                {payload.workloadSettings.maxActiveApplications ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Remaining Capacity">
                {payload.workloadSettings.remainingCapacity ?? "—"}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Text type="secondary">Workload settings are not available for this Applier.</Text>
          )}
        </Card>

        <Card title="Assigned Profiles">
          {payload.profiles.length ? (
            <div className="applier-detail-profiles-list">
              {payload.profiles.map((profile) => (
                <div key={profile.resumeId || profile.resume_id} className="applier-detail-profile-item">
                  <Text>{profileLabel(profile)}</Text>
                  <Tag color="blue">Assigned</Tag>
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary">No Resume profiles are assigned yet.</Text>
          )}
        </Card>
      </div>

      <Card
        title="Activity Timeline"
        extra={
          activityTotal ? (
            <Text type="secondary">
              Showing {activityItems.length.toLocaleString()} of {activityTotal.toLocaleString()} events
            </Text>
          ) : null
        }
      >
        {activityItems.length ? (
          <>
            <div className="applier-detail-activity-table-host">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                columns={activityColumns}
                dataSource={activityItems}
              />
            </div>
            {activityHasMore ? (
              <Flex justify="center" style={{ marginTop: 16 }}>
                <Button onClick={loadMoreActivity} loading={activityLoading}>
                  Load more activity
                </Button>
              </Flex>
            ) : null}
          </>
        ) : (
          <Text type="secondary">No activity recorded for this Applier in the selected period.</Text>
        )}
      </Card>
    </div>
  );
}
