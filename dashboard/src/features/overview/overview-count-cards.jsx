import React from "react";
import { CheckCircleOutlined, FileTextOutlined } from "@ant-design/icons";
import { OverviewKpiCard, OverviewKpiGrid, OverviewSection } from "./overview-ui.jsx";

export function BusinessRecordCards({ jobCounts = {} }) {
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
  ];
  return (
    <OverviewSection
      title="Business Records"
      description="Job Description inventory across the platform."
    >
      <OverviewKpiGrid>
        {cards.map((card) => (
          <OverviewKpiCard key={card.key} {...card} />
        ))}
      </OverviewKpiGrid>
    </OverviewSection>
  );
}
