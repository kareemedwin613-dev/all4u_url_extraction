import React, { useEffect, useState } from "react";
import { Button, Col, Input, Row, Select } from "antd";
import { FilterPanel } from "../../components/ui.jsx";
import { formatLabel } from "../../shared/formatters.js";
import { isEmailLike, personDisplayName } from "../../shared/person-name.js";
import { SENIORITIES } from "../../shared/constants.js";
import { countActiveJobFilters } from "../../shared/query-state.js";

const REVIEW_STATUS_OPTIONS = [
  { value: "ALL", label: "All review statuses" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "NEEDS_CORRECTION", label: "Needs Correction" },
  { value: "DECLINED", label: "Declined" },
];

const URL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active URLs" },
  { value: "ARCHIVED", label: "Declined / archived URLs" },
  { value: "ALL", label: "All URLs" },
];

const CAPTURED_WINDOW_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "THIS_MONTH", label: "This month" },
];

export function JobListFilters({ filters, categories, capturers = [], onChange }) {
  const field = { xs: 24, sm: 12, lg: 8, xl: 6 },
    activeCount = countActiveJobFilters(filters),
    [companyDraft, setCompanyDraft] = useState(filters.company || ""),
    [jobTitleDraft, setJobTitleDraft] = useState(filters.jobTitle || ""),
    [sourceUrlDraft, setSourceUrlDraft] = useState(filters.sourceUrl || "");
  useEffect(() => {
    setCompanyDraft(filters.company || "");
  }, [filters.company]);
  useEffect(() => {
    setJobTitleDraft(filters.jobTitle || "");
  }, [filters.jobTitle]);
  useEffect(() => {
    setSourceUrlDraft(filters.sourceUrl || "");
  }, [filters.sourceUrl]);

  function clearFilters() {
    onChange({
      search: "",
      company: "",
      jobTitle: "",
      sourceUrl: "",
      categoryId: "",
      seniority: "",
      status: "ACTIVE",
      reviewStatus: "ALL",
      capturedByUserId: "",
      capturedWindow: "",
      capturedFrom: "",
      capturedTo: "",
      page: 1,
    });
  }

  return (
    <FilterPanel activeCount={activeCount} defaultOpen={activeCount > 0}>
      <Row gutter={[12, 12]}>
        <Col {...field}>
          <label>
            Company
            <Input.Search
              allowClear
              value={companyDraft}
              placeholder="Company name"
              onChange={(event) => setCompanyDraft(event.target.value)}
              onSearch={(company) =>
                onChange({ company: company.trim().slice(0, 100), page: 1 })
              }
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Job title
            <Input.Search
              allowClear
              value={jobTitleDraft}
              placeholder="Job title"
              onChange={(event) => setJobTitleDraft(event.target.value)}
              onSearch={(jobTitle) =>
                onChange({ jobTitle: jobTitle.trim().slice(0, 100), page: 1 })
              }
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Job Posting URL
            <Input.Search
              allowClear
              value={sourceUrlDraft}
              placeholder="Paste or type part of the URL"
              onChange={(event) => setSourceUrlDraft(event.target.value)}
              onSearch={(sourceUrl) =>
                onChange({ sourceUrl: sourceUrl.trim().slice(0, 500), page: 1 })
              }
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Primary Category
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={filters.categoryId || undefined}
              placeholder="All categories"
              onChange={(categoryId) =>
                onChange({ categoryId: categoryId || "", page: 1 })
              }
              options={(categories?.primary || []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Seniority
            <Select
              allowClear
              value={filters.seniority || undefined}
              placeholder="All seniorities"
              onChange={(seniority) =>
                onChange({ seniority: seniority || "", page: 1 })
              }
              options={SENIORITIES.map((value) => ({
                value,
                label: formatLabel(value),
              }))}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            URL status
            <Select
              value={filters.status || "ACTIVE"}
              onChange={(status) =>
                onChange({ status: status || "ACTIVE", page: 1 })
              }
              options={URL_STATUS_OPTIONS}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Review status
            <Select
              value={filters.reviewStatus || "ALL"}
              onChange={(reviewStatus) =>
                onChange({ reviewStatus: reviewStatus || "ALL", page: 1 })
              }
              options={REVIEW_STATUS_OPTIONS}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Captured by
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={filters.capturedByUserId || undefined}
              placeholder="All capturers"
              onChange={(capturedByUserId) =>
                onChange({ capturedByUserId: capturedByUserId || "", page: 1 })
              }
              options={capturers.map((item) => {
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
                  value: item.id,
                  label: `${name}${emailSuffix} (${item.capturedCount})`,
                };
              })}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Captured
            <Select
              allowClear
              value={filters.capturedWindow || undefined}
              placeholder="Any time"
              onChange={(capturedWindow) =>
                onChange({
                  capturedWindow: capturedWindow || "",
                  capturedFrom: "",
                  capturedTo: "",
                  page: 1,
                })
              }
              options={CAPTURED_WINDOW_OPTIONS}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field} className="filter-actions">
          <Button disabled={!activeCount} onClick={clearFilters}>
            Clear filters
          </Button>
        </Col>
      </Row>
    </FilterPanel>
  );
}
