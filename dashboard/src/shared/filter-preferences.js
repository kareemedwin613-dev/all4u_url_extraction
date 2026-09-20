import { parseJobQuery, parseResumeQuery, parseUserQuery } from "./query-state.js";
import { parseApplicationQuery } from "../features/applications/query-state.js";
import { allowed, normalizeDateInput, normalizePage } from "./validation.js";
import { DEFAULT_OVERVIEW_WINDOW, OVERVIEW_WINDOWS, formatOverviewRangeLabel } from "../features/overview/overview-date.js";

export const FILTER_DEFAULTS_QUERY = "filters=default";
export const filterHref = (path, query = "") => `${path}?${query || FILTER_DEFAULTS_QUERY}`;
const text = (value, limit = 100) => String(value || "").trim().slice(0, limit);

export function parsePeriodQuery(query = "") {
  const params = new URLSearchParams(query);
  const window = allowed(params.get("window"), OVERVIEW_WINDOWS.map(item => item.value), "TODAY");
  if (window !== "CUSTOM") return { window, from: "", to: "" };
  const from = normalizeDateInput(params.get("from")), to = normalizeDateInput(params.get("to"));
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  return from && to && days >= 0 && days < 370
    ? { window, from, to } : { window: "TODAY", from: "", to: "" };
}

export function periodFromFilterQuery(query = "") {
  const period = parsePeriodQuery(query);
  return { ...period, label: period.window === "CUSTOM"
    ? formatOverviewRangeLabel(period.from, period.to)
    : OVERVIEW_WINDOWS.find(item => item.value === period.window)?.label || DEFAULT_OVERVIEW_WINDOW.label };
}

export function parseBatchListQuery(query = "") {
  const params = new URLSearchParams(query);
  const sorts = ["name", "creator", "created", "selected", "requested", "created_count", "duplicate", "skipped", "failed", "status"];
  return {
    search: text(params.get("search")),
    status: allowed(params.get("status"), ["PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"]),
    sort: allowed(params.get("sort"), sorts.flatMap(key => [`${key}_asc`, `${key}_desc`]), "created_desc"),
    page: normalizePage(params.get("page")),
  };
}

export const parseTailoringQuery = (query = "") => ({ status: allowed(new URLSearchParams(query).get("status"),
  ["ALL", "PENDING", "PROCESSING", "NEEDS_REVIEW", "APPROVED", "MATERIALIZING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"], "ALL") });
export const parseWorkloadQuery = (query = "") => ({ search: text(new URLSearchParams(query).get("search")) });
export const parseBatchResultQuery = (query = "") => ({ outcome: allowed(new URLSearchParams(query).get("outcome"),
  ["CREATED", "DUPLICATE", "SKIPPED", "FAILED"]) });

export const parseLocalSearchQuery = (query = "") => ({ search: String(new URLSearchParams(query).get("search") || "").slice(0, 200) });
export function parseBulkPreviewQuery(query = "") {
  const params = new URLSearchParams(query);
  return {
    search: String(params.get("search") || "").slice(0, 200),
    ...Object.fromEntries(["company", "categoryId", "candidate", "resume", "exclusionCode"].map(key => [key, text(params.get(key), 300)])),
    eligibility: allowed(params.get("eligibility"), ["ELIGIBLE", "EXCLUDED"]),
    pageSize: allowed(Number(params.get("pageSize")), [25, 50, 100], 25),
  };
}

const routeParsers = {
  overview: parsePeriodQuery, jobs: parseJobQuery, resumes: parseResumeQuery,
  applications: parseApplicationQuery, "admin-users": parseUserQuery,
  "applier-detail": parsePeriodQuery, "tailoring-jobs": parseTailoringQuery,
  "applier-workloads": parseWorkloadQuery, "application-batches": parseBatchListQuery,
  "application-batch-detail": parseBatchResultQuery,
};

// Only parsed, allowlisted filter fields are stored. Never store row selections,
// runner tickets, draft IDs, API responses or the current pagination position.
export function savedFilterQuery(query, parse) {
  const defaults = parse(""), value = parse(query), params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    if (key !== "page" && value[key] != null && value[key] !== defaults[key]) params.set(key, String(value[key]));
  }
  return params.toString();
}

export function createFilterPreferences({ userId, apiBaseUrl = "", storage = () => globalThis.localStorage } = {}) {
  const scope = JSON.stringify([userId || "", String(apiBaseUrl).replace(/\/+$/, "")]);
  const prefix = `dashboard-filters:v1:${encodeURIComponent(scope)}:`;
  const memory = new Map();
  const keyFor = page => `${prefix}${encodeURIComponent(page)}`;
  function read(page, parse) {
    if (!userId) return "";
    if (memory.has(page)) return memory.get(page);
    try {
      const raw = storage()?.getItem(keyFor(page));
      if (!raw || raw.length > 20000) return "";
      const value = JSON.parse(raw);
      return value?.version === 1 && typeof value.query === "string" ? savedFilterQuery(value.query, parse) : "";
    } catch { return ""; }
  }
  function write(page, query, parse) {
    if (!userId) return;
    const clean = savedFilterQuery(query, parse);
    memory.set(page, clean);
    try {
      const target = storage(), key = keyFor(page);
      if (!clean) target?.removeItem(key);
      else {
        const value = JSON.stringify({ version: 1, query: clean });
        if (target?.getItem(key) !== value) target?.setItem(key, value);
      }
    } catch { /* Browsing still works when storage is disabled or full. */ }
  }
  function resolve(route) {
    const parse = routeParsers[route.name];
    if (!parse || !userId || route.query) return route;
    const query = read(route.path, parse);
    return query ? { ...route, query } : route;
  }
  function remember(route) {
    const parse = routeParsers[route.name];
    if (parse) write(route.path, new URLSearchParams(route.query).get("filters") === "default" ? "" : route.query, parse);
  }
  return { scope, read, write, resolve, remember };
}
