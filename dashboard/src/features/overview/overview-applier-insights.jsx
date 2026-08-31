import React, { useMemo } from "react";
import { Card } from "antd";
import {
  ProductivityLeaders,
  ProductivityNeedsAttention,
} from "./applier-productivity-table.jsx";
import {
  getNeedsAttentionAppliers,
  getTopPerformers,
  normalizeApplierProductivity,
} from "./applier-productivity.js";
import { OverviewSection } from "./overview-ui.jsx";

export function OverviewApplierInsights({ client, apiBaseUrl, rows = [], dateRange }) {
  const data = useMemo(
    () => normalizeApplierProductivity(rows, { dateRange }),
    [rows, dateRange],
  );
  const needsAttention = useMemo(() => getNeedsAttentionAppliers(data, 5), [data]);
  const leaders = useMemo(() => getTopPerformers(data, 5), [data]);

  return (
    <OverviewSection
      title="Applier Insights"
      description="Appliers who need follow-up and the strongest performers in this period."
    >
      <div className="overview-insights-grid">
        <Card className="overview-chart-card" title="Needs Attention">
          <ProductivityNeedsAttention items={needsAttention} client={client} apiBaseUrl={apiBaseUrl} />
        </Card>
        <Card className="overview-chart-card" title="Top Performers">
          <ProductivityLeaders items={leaders} client={client} apiBaseUrl={apiBaseUrl} />
        </Card>
      </div>
    </OverviewSection>
  );
}
