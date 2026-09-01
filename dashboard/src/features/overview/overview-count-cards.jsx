import React from "react";
import { CheckCircleOutlined, FileTextOutlined, ProfileOutlined } from "@ant-design/icons";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";

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
