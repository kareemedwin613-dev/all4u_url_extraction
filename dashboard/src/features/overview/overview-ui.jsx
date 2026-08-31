import React from "react";
import { Card, Input, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";

const { Text, Title } = Typography;

export function OverviewSection({ title, description, children, className = "" }) {
  return (
    <section className={`overview-section ${className}`.trim()}>
      {title ? (
        <div className="overview-section__header">
          <Title level={3} className="overview-section__title">
            {title}
          </Title>
          {description ? (
            <Text type="secondary" className="overview-section__description">
              {description}
            </Text>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function OverviewKpiGrid({ children, columns }) {
  const className = columns
    ? `overview-kpi-grid overview-kpi-grid--${columns}`
    : "overview-kpi-grid";
  return <div className={className}>{children}</div>;
}

export function OverviewKpiCard({ tone = "blue", icon, value, label, meta }) {
  return (
    <div className={`overview-kpi-card overview-kpi-card--${tone}`}>
      <div className="overview-kpi-card__icon">{icon}</div>
      <div className="overview-kpi-card__body">
        <div className="overview-kpi-card__value">{value}</div>
        <div className="overview-kpi-card__label">{label}</div>
        {meta ? <div className="overview-kpi-card__meta">{meta}</div> : null}
      </div>
    </div>
  );
}

export function OverviewChartLegend({ metrics = [] }) {
  return (
    <div className="overview-chart-legend">
      {metrics.map((metric) => (
        <span key={metric.key} className="overview-chart-legend__item">
          <span
            className="overview-chart-legend__swatch"
            style={{ background: metric.color }}
            aria-hidden="true"
          />
          {metric.label}
        </span>
      ))}
    </div>
  );
}

export function OverviewChartCard({
  title,
  extra,
  children,
  search,
  searchPlaceholder,
  searchAriaLabel,
  onSearchChange,
  className = "",
}) {
  return (
    <Card
      className={`overview-chart-card ${className}`.trim()}
      title={title}
      extra={extra}
      style={{ height: "100%" }}
    >
      {search != null ? (
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="overview-chart-card__search"
        />
      ) : null}
      {children}
    </Card>
  );
}
