import React, { useEffect, useState } from "react";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  ProfileOutlined,
  StopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert } from "antd";
import { getApplicationCounts } from "../applications/application-service.js";
import { isApplicationManager } from "../applications/validation.js";
import { LoadingState } from "../../components/ui.jsx";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";

const Notice = ({ message }) =>
  message ? <Alert className="ui-alert" type="error" showIcon message={message} /> : null;

function managerCards(data, dateLabel, isAdmin) {
  return [
    {
      key: "total",
      tone: "blue",
      icon: <FileTextOutlined />,
      value: Number(data.total || 0),
      label: "Total Applications",
      meta: "Created in this period",
    },
    {
      key: "applied",
      tone: "green",
      icon: <CheckCircleOutlined />,
      value: Number(data.applied_today || 0),
      label: `Applied · ${dateLabel}`,
      meta: "Submitted in this period",
    },
    {
      key: "blocked",
      tone: "red",
      icon: <StopOutlined />,
      value: Number(data.blocked || 0),
      label: "Blocked",
      meta: "Need attention",
    },
    ...(!isAdmin
      ? [
          {
            key: "overdue",
            tone: "orange",
            icon: <ClockCircleOutlined />,
            value: Number(data.overdue || 0),
            label: "Overdue",
            meta: "Past due date",
          },
        ]
      : []),
    {
      key: "interviews",
      tone: "purple",
      icon: <CalendarOutlined />,
      value: Number(data.interviews || 0),
      label: "Interviews",
      meta: "Interview scheduled",
    },
  ];
}

function applierCards(data, dateLabel) {
  return [
    {
      key: "assigned",
      tone: "blue",
      icon: <UserOutlined />,
      value: Number(data.my_assigned || 0),
      label: "My Assigned Applications",
      meta: "Assigned to you",
    },
    {
      key: "applied",
      tone: "green",
      icon: <CheckCircleOutlined />,
      value: Number(data.applied_today || 0),
      label: `Applied · ${dateLabel}`,
      meta: "Submitted in this period",
    },
    {
      key: "blocked",
      tone: "red",
      icon: <StopOutlined />,
      value: Number(data.blocked || 0),
      label: "Blocked",
      meta: "Need attention",
    },
    {
      key: "interviews",
      tone: "purple",
      icon: <CalendarOutlined />,
      value: Number(data.interviews || 0),
      label: "Interviews",
      meta: "Interview scheduled",
    },
  ];
}

export function ApplicationCountCards({
  client,
  apiBaseUrl,
  access,
  reload,
  dateRange,
  dateLabel = "Today",
}) {
  const [data, setData] = useState(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError("");
    getApplicationCounts(client, apiBaseUrl, dateRange)
      .then((value) => live && setData(value))
      .catch((value) => live && setError(value.message));
    return () => {
      live = false;
    };
  }, [client, apiBaseUrl, reload, dateRange?.from, dateRange?.to]);
  if (error) return <Notice message={error} />;
  if (!data) return <LoadingState />;
  const manager = isApplicationManager(access),
    isAdmin = access?.capabilities?.has("USER_ADMIN"),
    cards = manager
      ? managerCards(data, dateLabel, isAdmin)
      : applierCards(data, dateLabel);
  return (
    <OverviewSection
      title="Application Workflow"
      description={`Application activity for ${dateLabel.toLowerCase()}.`}
    >
      <OverviewKpiGrid columns={cards.length >= 5 ? 5 : 4}>
        {cards.map((card) => (
          <OverviewKpiCard key={card.key} {...card} />
        ))}
      </OverviewKpiGrid>
    </OverviewSection>
  );
}

export function BusinessRecordCards({ jobCounts = {}, resumeCounts = {} }) {
  const cards = [
    {
      key: "jobs-total",
      tone: "blue",
      icon: <FileTextOutlined />,
      value: Number(jobCounts.total || 0),
      label: "Total Job Descriptions",
      meta: "All captured JDs",
    },
    {
      key: "jobs-active",
      tone: "green",
      icon: <CheckCircleOutlined />,
      value: Number(jobCounts.active || 0),
      label: "Active Job Descriptions",
      meta: "Available for applications",
    },
    {
      key: "resumes-total",
      tone: "indigo",
      icon: <ProfileOutlined />,
      value: Number(resumeCounts.total || 0),
      label: "Total Resumes",
      meta: "Original and tailored",
    },
    {
      key: "resumes-active",
      tone: "teal",
      icon: <CheckCircleOutlined />,
      value: Number(resumeCounts.active || 0),
      label: "Active Resumes",
      meta: "Ready for assignment",
    },
  ];
  return (
    <OverviewSection
      title="Business Records"
      description="Job Description and Resume inventory across the platform."
    >
      <OverviewKpiGrid columns={4}>
        {cards.map((card) => (
          <OverviewKpiCard key={card.key} {...card} />
        ))}
      </OverviewKpiGrid>
    </OverviewSection>
  );
}
