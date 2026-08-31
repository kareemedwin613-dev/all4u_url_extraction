import React, { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ProductivityActivityDonut } from "./applier-productivity-table.jsx";
import { buildActivityOverviewSegments } from "./applier-productivity.js";

export function ActivityOverviewChart({ counts = {} }) {
  const segments = useMemo(() => buildActivityOverviewSegments(counts), [counts]);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return <ProductivityActivityDonut segments={[]} />;
  }
  return (
    <div className="productivity-donut">
      <div className="productivity-donut__chart" style={{ width: 120, height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius={36}
              outerRadius={54}
              paddingAngle={2}
            >
              {segments.map((segment) => (
                <Cell key={segment.key} fill={segment.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="productivity-donut__center">
          <strong>{total}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="productivity-donut__legend">
        {segments.map((segment) => (
          <div key={segment.key} className="productivity-donut__legend-item">
            <span className="productivity-donut__legend-label">
              <span
                className="productivity-donut__swatch"
                style={{ background: segment.color }}
              />
              <span>{segment.label}</span>
            </span>
            <strong>
              {segment.value} ({Math.round((segment.value / total) * 1000) / 10}%)
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
