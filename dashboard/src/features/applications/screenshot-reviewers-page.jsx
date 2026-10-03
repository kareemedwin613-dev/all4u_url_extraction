import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App as AntApp, Button, Card, Col, Flex, Input, Row, Select, Table, Typography } from "antd";
import { CAPABILITIES, hasCapability } from "../../access/capabilities.js";
import { ROLE_CODES } from "../../access/role-codes.js";
import { DataPagination, FilterPanel, StatusTag } from "../../components/ui.jsx";
import { navigate } from "../../router.js";
import { filterHref, periodFromFilterQuery } from "../../shared/filter-preferences.js";
import { useTableBodyHeight } from "../../shared/use-table-body-height.js";
import { OverviewDateFilter } from "../overview/overview-date-filter.jsx";
import { overviewDateBounds } from "../overview/overview-date.js";
import { ScreenshotReviewModal } from "./screenshot-review-modal.jsx";
import {
  UNASSIGNED_FILTER,
  countScreenshotReviewerFilters,
  parseScreenshotReviewerFilters,
  screenshotMatchesReviewFilter,
  screenshotReviewerRowMatches,
} from "./screenshot-reviewer-filters.js";
import {
  listProfileScreenshotApplications,
  listScreenshotReviewAssignments,
  listScreenshotReviewerCandidates,
  setScreenshotProfileReviewers,
} from "./application-service.js";

const { Text } = Typography;
const PAGE_SIZES = [25, 50, 100, 500, 1000, 5000];

function reviewerLabel(person) {
  return String(person?.fullName || person?.full_name || "").trim() || "Reviewer";
}

function assignedOptions(rows, candidates, idKey, nameKey) {
  const labels = new Map(candidates.map((person) => [person.id, reviewerLabel(person)]));
  for (const row of rows || []) {
    if (row[idKey] && !labels.has(row[idKey])) labels.set(row[idKey], reviewerLabel({ fullName: row[nameKey] }));
  }
  return [
    { value: UNASSIGNED_FILTER, label: "Unassigned" },
    ...[...labels.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function applierOptions(rows) {
  const names = new Set();
  for (const row of rows || []) {
    const name = String(row.current_applier_name || "").trim();
    if (name) names.add(name);
  }
  return [
    { value: UNASSIGNED_FILTER, label: "Unassigned" },
    ...[...names].sort((left, right) => left.localeCompare(right)).map((name) => ({ value: name, label: name })),
  ];
}

function ScreenshotReviewerFilters({ filters, isAdmin, primaryOptions, secondaryOptions, appliers, onChange }) {
  const field = { xs: 24, sm: 12, lg: 8, xl: 6 };
  const activeCount = countScreenshotReviewerFilters(filters, { isAdmin });
  const [profileDraft, setProfileDraft] = useState(filters.profile);
  useEffect(() => {
    setProfileDraft(filters.profile);
  }, [filters.profile]);
  return (
    <FilterPanel activeCount={activeCount} defaultOpen={activeCount > 0}>
      <Row gutter={[12, 12]}>
        <Col {...field}>
          <label>
            Profile
            <Input.Search
              allowClear
              value={profileDraft}
              placeholder="Profile name"
              onChange={(event) => setProfileDraft(event.target.value)}
              onSearch={(profile) => onChange({ profile: profile.trim().slice(0, 100) })}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Status
            <Select
              allowClear
              value={filters.status || undefined}
              placeholder="All statuses"
              onChange={(status) => onChange({ status: status || "" })}
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        {isAdmin ? (
          <Col {...field}>
            <label>
              Current Applier
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                value={filters.currentApplier || undefined}
                placeholder="All appliers"
                onChange={(currentApplier) => onChange({ currentApplier: currentApplier || "" })}
                options={appliers}
                style={{ width: "100%" }}
              />
            </label>
          </Col>
        ) : null}
        <Col {...field}>
          <label>
            Primary Reviewer
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={filters.primaryReviewer || undefined}
              placeholder="All reviewers"
              onChange={(primaryReviewer) => onChange({ primaryReviewer: primaryReviewer || "" })}
              options={primaryOptions}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Secondary Reviewer
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={filters.secondaryReviewer || undefined}
              placeholder="All reviewers"
              onChange={(secondaryReviewer) => onChange({ secondaryReviewer: secondaryReviewer || "" })}
              options={secondaryOptions}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field}>
          <label>
            Review
            <Select
              allowClear
              value={filters.review || undefined}
              placeholder="All"
              onChange={(review) => onChange({ review: review || "" })}
              options={[
                { value: "CORRECT", label: "Correct" },
                { value: "HAS_MISTAKES", label: "Has mistakes" },
                { value: "NOT_REVIEWED", label: "Not-checked" },
              ]}
              style={{ width: "100%" }}
            />
          </label>
        </Col>
        <Col {...field} className="filter-actions">
          <Button
            disabled={!activeCount}
            onClick={() => onChange({
              profile: "",
              status: "",
              currentApplier: "",
              primaryReviewer: "",
              secondaryReviewer: "",
              review: "",
            })}
          >
            Clear filters
          </Button>
        </Col>
      </Row>
    </FilterPanel>
  );
}

export function ScreenshotReviewersPage({ client, apiBaseUrl, access, query = "" }) {
  const { message, modal } = AntApp.useApp();
  const canAssign = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE);
  const isAdmin = (access?.roles || []).includes(ROLE_CODES.ADMIN);
  const period = useMemo(() => periodFromFilterQuery(query), [query]);
  const range = useMemo(
    () => overviewDateBounds(period),
    [period.window, period.from, period.to],
  );
  const [rows, setRows] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const filters = useMemo(() => parseScreenshotReviewerFilters(query), [query]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [savingId, setSavingId] = useState("");
  const [review, setReview] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tableHostRef, tableBodyHeight] = useTableBodyHeight(rows != null);
  const reviewFilters = useMemo(() => ({ pageSize: 25, review: filters.review || "" }), [filters.review]);
  const loadGeneration = useRef(0);

  const replaceQuery = (mutate) => {
    const params = new URLSearchParams(query);
    params.delete("filters");
    mutate(params);
    setPage(1);
    navigate(filterHref("#/screenshot-reviewers", params.toString()));
  };

  const setPeriod = (value) => {
    replaceQuery((params) => {
      params.set("window", value.window);
      if (value.from) params.set("from", value.from);
      else params.delete("from");
      if (value.to) params.set("to", value.to);
      else params.delete("to");
    });
  };

  const updateFilters = (patch) => {
    replaceQuery((params) => {
      for (const [key, value] of Object.entries(patch)) {
        const text = String(value || "").trim();
        if (text) params.set(key, text);
        else params.delete(key);
      }
    });
  };

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!range) {
      setRows([]);
      setError("Select a valid reporting period.");
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      const [assignments, people] = await Promise.all([
        listScreenshotReviewAssignments(client, apiBaseUrl, range),
        canAssign ? listScreenshotReviewerCandidates(client, apiBaseUrl) : Promise.resolve([]),
      ]);
      if (generation !== loadGeneration.current) return;
      setRows(Array.isArray(assignments) ? assignments : []);
      setCandidates(Array.isArray(people) ? people : []);
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      setRows([]);
      setError(caught.message || "Screenshot reviewers could not be loaded.");
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, [apiBaseUrl, canAssign, client, range]);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo(() => [
    { value: "", label: "Unassigned" },
    ...candidates.map((person) => ({ value: person.id, label: reviewerLabel(person) })),
  ], [candidates]);

  function reviewerOptions(row, side) {
    const selectedId = side === "primary" ? row.primary_reviewer_id : row.secondary_reviewer_id;
    const otherId = side === "primary" ? row.secondary_reviewer_id : row.primary_reviewer_id;
    const selectedName = side === "primary" ? row.primary_reviewer_name : row.secondary_reviewer_name;
    const list = options.map((option) => ({ ...option, disabled: Boolean(option.value && option.value === otherId) }));
    if (selectedId && !list.some((option) => option.value === selectedId)) {
      list.splice(1, 0, { value: selectedId, label: reviewerLabel({ fullName: selectedName }), disabled: false });
    }
    return list;
  }

  const primaryOptions = useMemo(
    () => assignedOptions(rows, candidates, "primary_reviewer_id", "primary_reviewer_name"),
    [rows, candidates],
  );
  const secondaryOptions = useMemo(
    () => assignedOptions(rows, candidates, "secondary_reviewer_id", "secondary_reviewer_name"),
    [rows, candidates],
  );
  const appliers = useMemo(() => applierOptions(rows), [rows]);
  const visible = useMemo(() => {
    return (rows || []).filter((row) => screenshotReviewerRowMatches(row, filters, { isAdmin })).sort((left, right) => {
      const rank = (row) => (String(row.resume_status || "").toUpperCase() === "ACTIVE" ? 0 : 1);
      return rank(left) - rank(right)
        || String(left.candidate_name || "").localeCompare(String(right.candidate_name || ""))
        || String(left.candidate_email || "").localeCompare(String(right.candidate_email || ""));
    });
  }, [rows, filters, isAdmin]);

  const screenshotTotal = visible.reduce((sum, row) => sum + (Number(row.screenshot_count) || 0), 0);
  const reviewedTotal = visible.reduce((sum, row) => sum + (Number(row.reviewed_screenshot_count) || 0), 0);
  const unreviewedTotal = visible.reduce((sum, row) => sum + (Number(row.unreviewed_screenshot_count) || 0), 0);
  const mistakeTotal = visible.reduce((sum, row) => sum + (Number(row.mistake_screenshot_count) || 0), 0);
  const applicationTotal = visible.reduce((sum, row) => sum + (Number(row.application_count) || 0), 0);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagination = {
    page: currentPage,
    pageSize,
    total: visible.length,
    from: visible.length ? (currentPage - 1) * pageSize + 1 : 0,
    to: Math.min(currentPage * pageSize, visible.length),
  };

  function reviewerDisplayName(id, currentName) {
    if (!id) return null;
    const person = candidates.find((item) => item.id === id);
    return person ? reviewerLabel(person) : (currentName || null);
  }

  function confirmReviewerChange(row, side, nextId) {
    const currentId = side === "primary" ? (row.primary_reviewer_id || "") : (row.secondary_reviewer_id || "");
    if (String(nextId || "") === String(currentId)) return;
    const role = side === "primary" ? "Primary Reviewer" : "Secondary Reviewer";
    const profile = row.candidate_name || row.resume_name || "this profile";
    const currentName = (side === "primary" ? row.primary_reviewer_name : row.secondary_reviewer_name) || "Unassigned";
    const nextName = nextId ? reviewerDisplayName(nextId, "this reviewer") : "Unassigned";
    modal.confirm({
      title: `Change ${role}?`,
      content: `Change the ${role} for ${profile} from ${currentName} to ${nextName}?`,
      okText: "Change",
      cancelText: "Cancel",
      onOk: () => save(
        row,
        side === "primary" ? nextId : (row.primary_reviewer_id || ""),
        side === "secondary" ? nextId : (row.secondary_reviewer_id || ""),
      ),
    });
  }

  async function save(row, primaryReviewerId, secondaryReviewerId) {
    if (primaryReviewerId && primaryReviewerId === secondaryReviewerId) {
      message.error("Choose two different reviewers.");
      return;
    }
    setSavingId(row.resume_id);
    try {
      await setScreenshotProfileReviewers(client, apiBaseUrl, row.resume_id, {
        primaryReviewerId: primaryReviewerId || null,
        secondaryReviewerId: secondaryReviewerId || null,
      });
      setRows((current) => (current || []).map((item) => (
        item.resume_id === row.resume_id
          ? {
            ...item,
            primary_reviewer_id: primaryReviewerId || null,
            secondary_reviewer_id: secondaryReviewerId || null,
            primary_reviewer_name: reviewerDisplayName(primaryReviewerId, row.primary_reviewer_name),
            secondary_reviewer_name: reviewerDisplayName(secondaryReviewerId, row.secondary_reviewer_name),
          }
          : item
      )));
      message.success("Reviewers saved.");
    } catch (caught) {
      message.error(caught.message || "Reviewers could not be saved.");
    } finally {
      setSavingId("");
    }
  }

  const loadReviewPage = useCallback((pageFilters) => {
    if (!review?.profileId) return Promise.resolve({ items: [], pageCount: 0 });
    return listProfileScreenshotApplications(
      client,
      apiBaseUrl,
      review.profileId,
      pageFilters.page || 1,
      pageFilters.pageSize || 25,
      range,
      pageFilters.review || filters.review,
    );
  }, [apiBaseUrl, client, filters.review, range, review?.profileId]);

  async function openReview(row) {
    setError("");
    try {
      const page = await listProfileScreenshotApplications(client, apiBaseUrl, row.resume_id, 1, 25, range, filters.review);
      const items = page?.items || [];
      if (!items.length) {
        const empty = {
          CORRECT: "This profile has no correct screenshots in this date range.",
          HAS_MISTAKES: "This profile has no screenshots with mistakes in this date range.",
          NOT_REVIEWED: "This profile has no unchecked screenshots in this date range.",
        }[filters.review] || "This profile has no screenshots in this date range.";
        message.info(empty);
        return;
      }
      setReview({ application: items[0], items, page: page.page || 1, profileId: row.resume_id });
    } catch (caught) {
      setError(caught.message || "Screenshots could not be opened.");
    }
  }

  const columns = [
    {
      title: "No",
      key: "no",
      width: 64,
      align: "center",
      render: (_value, _row, index) => (currentPage - 1) * pageSize + index + 1,
    },
    {
      title: "Profile",
      width: 240,
      dataIndex: "candidate_name",
      render: (value, row) => value || row.resume_name || "Unnamed profile",
    },
    {
      title: "Status",
      dataIndex: "resume_status",
      width: 150,
      render: (value) => <StatusTag value={value} />,
    },
    ...(isAdmin ? [{
      title: "Current Applier",
      dataIndex: "current_applier_name",
      width: 150,
      render: (value) => value || "Unassigned",
    }] : []),
    { title: "Screenshots", dataIndex: "screenshot_count", width: 120 },
    { title: "Reviewed", dataIndex: "reviewed_screenshot_count", width: 110 },
    { title: "Not-Reviewed", dataIndex: "unreviewed_screenshot_count", width: 130 },
    { title: "Mistakes", dataIndex: "mistake_screenshot_count", width: 110 },
    { title: "Applications", dataIndex: "application_count", width: 130 },
    {
      title: "Primary Reviewer",
      dataIndex: "primary_reviewer_id",
      width: 160,
      render: (value, row) => canAssign ? (
        <Select
          aria-label={`Primary Reviewer for ${row.candidate_name || row.resume_name || "profile"}`}
          showSearch
          optionFilterProp="label"
          style={{ width: "100%" }}
          value={value || ""}
          options={reviewerOptions(row, "primary")}
          loading={savingId === row.resume_id}
          onChange={(next) => confirmReviewerChange(row, "primary", next)}
        />
      ) : (row.primary_reviewer_name || "Unassigned"),
    },
    {
      title: "Secondary Reviewer",
      dataIndex: "secondary_reviewer_id",
      width: 160,
      render: (value, row) => canAssign ? (
        <Select
          aria-label={`Secondary Reviewer for ${row.candidate_name || row.resume_name || "profile"}`}
          showSearch
          optionFilterProp="label"
          style={{ width: "100%" }}
          value={value || ""}
          options={reviewerOptions(row, "secondary")}
          loading={savingId === row.resume_id}
          onChange={(next) => confirmReviewerChange(row, "secondary", next)}
        />
      ) : (row.secondary_reviewer_name || "Unassigned"),
    },
    {
      title: "",
      key: "review",
      width: 110,
      fixed: "right",
      render: (_, row) => <Button onClick={() => openReview(row)}>Review</Button>,
    },
  ];
  const tableScrollX = columns.reduce((sum, column) => sum + (Number(column.width) || 0), 0);

  return (
    <div className="page page-list">
      <div className="page-toolbar">
        <Flex justify="space-between" align="flex-start" gap={16} wrap="wrap">
          <Text type="secondary">Each applicant profile has one primary reviewer and one secondary reviewer. Counts use the applied date, the same way Overview does.</Text>
          <OverviewDateFilter compact value={period} onChange={setPeriod} refreshing={refreshing} onRefresh={load} refreshLabel="Refresh screenshot reviewers" />
        </Flex>
        {error ? <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} /> : null}
        <div style={{ marginTop: 12 }}>
          <ScreenshotReviewerFilters
            filters={filters}
            isAdmin={isAdmin}
            primaryOptions={primaryOptions}
            secondaryOptions={secondaryOptions}
            appliers={appliers}
            onChange={updateFilters}
          />
        </div>
      </div>
      <Card className="page-list-card">
        <div ref={tableHostRef} className="page-list-table-host">
          <Table
            className="dashboard-ellipsis-table screenshot-reviewers-table"
            rowKey="resume_id"
            loading={rows == null}
            columns={columns}
            dataSource={pageRows}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: tableScrollX, y: tableBodyHeight }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} />
                  <Table.Summary.Cell index={1}>Total</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                  {isAdmin ? <Table.Summary.Cell index={3} /> : null}
                  <Table.Summary.Cell index={isAdmin ? 4 : 3}>{screenshotTotal.toLocaleString()}</Table.Summary.Cell>
                  <Table.Summary.Cell index={isAdmin ? 5 : 4}>{reviewedTotal.toLocaleString()}</Table.Summary.Cell>
                  <Table.Summary.Cell index={isAdmin ? 6 : 5}>{unreviewedTotal.toLocaleString()}</Table.Summary.Cell>
                  <Table.Summary.Cell index={isAdmin ? 7 : 6}>{mistakeTotal.toLocaleString()}</Table.Summary.Cell>
                  <Table.Summary.Cell index={isAdmin ? 8 : 7}>{applicationTotal.toLocaleString()}</Table.Summary.Cell>
                  <Table.Summary.Cell index={isAdmin ? 9 : 8} />
                  <Table.Summary.Cell index={isAdmin ? 10 : 9} />
                  <Table.Summary.Cell index={isAdmin ? 11 : 10} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </div>
        <DataPagination
          data={pagination}
          pageSizeOptions={PAGE_SIZES}
          onPage={(nextPage, nextSize) => {
            const size = nextSize || pageSize;
            setPage(size === pageSize ? nextPage : 1);
            setPageSize(size);
          }}
        />
      </Card>
      <ScreenshotReviewModal
        client={client}
        apiBaseUrl={apiBaseUrl}
        manager
        review={review}
        filters={reviewFilters}
        loadPage={loadReviewPage}
        onClose={() => setReview(null)}
        onMove={(next) => setReview((current) => ({ ...next, profileId: current?.profileId }))}
        onFeedbackSaved={(applicationId, updated) => {
          setReview((current) => {
            if (!current) return current;
            return {
              ...current,
              items: (current.items || []).flatMap((item) => {
                if (item.id !== applicationId) return [item];
                const next = { ...item, ...updated };
                return screenshotMatchesReviewFilter(next.screenshot_review_status, filters.review) ? [next] : [];
              }),
            };
          });
          load();
        }}
      />
    </div>
  );
}
