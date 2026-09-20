import test from "node:test";
import assert from "node:assert/strict";
import { createFilterPreferences, filterHref, parsePeriodQuery, periodFromFilterQuery, parseBulkPreviewQuery, savedFilterQuery } from "../src/shared/filter-preferences.js";
import { parseJobQuery, parseResumeQuery } from "../src/shared/query-state.js";
import { parseApplicationQuery } from "../src/features/applications/query-state.js";
import { overviewDateBounds } from "../src/features/overview/overview-date.js";
import { parseRoute } from "../src/router.js";

const id = "f3a34ffd-d66a-49f7-815e-c7786857576b";
function setup() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const store = (userId = "alice", apiBaseUrl = "https://api.test") => createFilterPreferences({ userId, apiBaseUrl, storage: () => storage });
  return { data, store };
}

test("list preferences survive a new browser session, preserving filters and page size but not row selections or page position", () => {
  const { store, data } = setup();
  const query = new URLSearchParams({ company: "Acme", jobTitle: "Engineer", sourceUrl: "https://jobs.test/path?q=1", status: "ARCHIVED", categoryId: id,
    seniority: "SENIOR", capturedByUserId: id, capturedWindow: "CUSTOM", capturedFrom: "2026-09-01", capturedTo: "2026-09-18",
    reviewStatus: "APPROVED", sort: "company_asc", page: "8", pageSize: "100", selectedIds: "private-selection", ticket: "never-store-this" });
  store().remember(parseRoute(`#/jobs?${query}`));
  const restored = store().resolve(parseRoute("#/jobs"));
  assert.deepEqual(parseJobQuery(restored.query), { ...parseJobQuery(query.toString()), page: 1 });
  assert.doesNotMatch([...data.values()].join(""), /selectedIds|private-selection|ticket|never-store-this|page=/);
});

test("each page, account and API environment has independent filters", () => {
  const { store } = setup(), first = store();
  first.remember(parseRoute("#/jobs?company=Acme"));
  first.remember(parseRoute("#/resumes?status=ARCHIVED&search=Alice&pageSize=50&sort=created_desc"));
  first.remember(parseRoute(`#/applications?status=APPLIED&assignedTo=${id}&categoryId=${id}&company=Example&profileName=Alex&resumeName=Backend&creationBatchId=${id}&screenshotFeedback=HAS_FEEDBACK&pageSize=500`));
  assert.equal(parseJobQuery(first.resolve(parseRoute("#/jobs")).query).company, "Acme");
  assert.equal(parseResumeQuery(first.resolve(parseRoute("#/resumes")).query).search, "Alice");
  const apps = parseApplicationQuery(first.resolve(parseRoute("#/applications")).query);
  assert.equal(apps.assignedTo, id); assert.equal(apps.creationBatchId, id); assert.equal(apps.screenshotFeedback, "HAS_FEEDBACK");
  assert.equal(apps.profileName, "Alex"); assert.equal(apps.resumeName, "Backend"); assert.equal(apps.pageSize, 500);
  for (const other of [store("bob"), store("alice", "http://localhost:3000"), store("")]) {
    assert.equal(other.resolve(parseRoute("#/jobs")).query, "");
  }
  assert.equal(parseJobQuery(store("alice", "https://api.test/").resolve(parseRoute("#/jobs")).query).company, "Acme");
});

test("explicit links replace rather than merge remembered filters, including pagination links", () => {
  const { store } = setup(), prefs = store();
  prefs.remember(parseRoute("#/jobs?company=Old&reviewStatus=APPROVED&pageSize=100"));
  const link = parseRoute("#/jobs?seniority=SENIOR&page=3");
  assert.equal(prefs.resolve(link), link);
  prefs.remember(link);
  const next = parseJobQuery(prefs.resolve(parseRoute("#/jobs")).query);
  assert.equal(next.company, ""); assert.equal(next.reviewStatus, "ALL"); assert.equal(next.page, 1); assert.equal(next.seniority, "SENIOR");
});

test("reset removes the page preference and does not resurrect it after refresh or affect other pages", () => {
  const { store, data } = setup(), prefs = store();
  prefs.remember(parseRoute("#/jobs?company=Acme"));
  prefs.remember(parseRoute("#/resumes?search=Alice"));
  const reset = parseRoute(filterHref("#/jobs"));
  assert.equal(prefs.resolve(reset), reset);
  prefs.remember(reset);
  assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
  assert.equal(store().resolve(parseRoute("#/jobs")).query, "");
  assert.equal(data.size, 1);
  assert.match(store().resolve(parseRoute("#/resumes")).query, /Alice/);
});

test("only supported filter routes are persisted; workflow and authentication URLs are excluded", () => {
  const { store, data } = setup(), prefs = store();
  for (const url of ["#/login?ticket=secret", "#/profile?token=secret", "#/applications/bulk-create?draft=secret", `#/applications/${id}?ticket=secret`, `#/tailoring-jobs/${id}?ticket=secret`]) {
    const route = parseRoute(url);
    prefs.remember(route); assert.equal(prefs.resolve(route), route);
  }
  assert.equal(data.size, 0);
});

test("all additional routed filters restore and detail page preferences are independent", () => {
  const { store } = setup(), prefs = store();
  const links = ["#/admin/users?roleCode=APPLIER&status=ACTIVE&sort=name_desc&pageSize=50", "#/tailoring-jobs?status=FAILED",
    "#/applier-workloads?search=Alex", "#/application-batches?search=Weekly&status=FAILED&sort=created_count_desc",
    `#/application-batches/${id}?outcome=SKIPPED`, `#/appliers/${id}?window=THIS_MONTH`];
  for (const link of links) {
    const route = parseRoute(link); prefs.remember(route);
    assert.deepEqual([...new URLSearchParams(prefs.resolve({ ...route, query: "" }).query)].sort(), [...new URLSearchParams(route.query)].sort());
  }
  assert.equal(prefs.resolve(parseRoute("#/appliers/b4d63a80-e306-4a2f-afca-29cd4b3951e0")).query, "");
});

test("relative date presets roll forward; custom dates are saved exactly and labels regenerated", () => {
  const { store } = setup();
  store().remember(parseRoute("#/?window=THIS_WEEK&from=2020-01-01&label=stale"));
  const period = periodFromFilterQuery(store().resolve(parseRoute("#/")).query);
  assert.equal(period.label, "This Week"); assert.equal(period.from, "");
  const earlier = overviewDateBounds(period, new Date(2026, 8, 14)), later = overviewDateBounds(period, new Date(2026, 8, 21));
  assert.notEqual(earlier.from, later.from);
  const query = "window=CUSTOM&from=2026-09-01&to=2026-09-18";
  store().remember(parseRoute(`#/?${query}`));
  assert.equal(store().resolve(parseRoute("#/")).query, query);
  assert.equal(periodFromFilterQuery(query).label, "Sep 1, 2026 - Sep 18, 2026");
});

test("malformed or outdated storage and invalid filter values fall back safely", () => {
  const { store, data } = setup();
  store().remember(parseRoute("#/jobs?company=Acme"));
  const key = [...data.keys()][0];
  for (const invalid of ["{", "null", JSON.stringify({ version: 99, query: "company=Wrong" }), JSON.stringify({ version: 1, query: {} }), "x".repeat(20001)]) {
    data.set(key, invalid);
    assert.equal(store().resolve(parseRoute("#/jobs")).query, "");
  }
  data.set(key, JSON.stringify({ version: 1, query: "status=BOGUS&categoryId=bad&pageSize=-1&ticket=secret" }));
  assert.equal(store().resolve(parseRoute("#/jobs")).query, "");
  for (const query of ["window=BOGUS", "window=CUSTOM&from=2026-02-30&to=2026-03-01", "window=CUSTOM&from=2026-09-20&to=2026-09-01", "window=CUSTOM&from=2020-01-01&to=2026-09-01"]) {
    assert.deepEqual(parsePeriodQuery(query), parsePeriodQuery(""));
  }
});

test("disabled/full storage does not break navigation and still remembers in the current session", () => {
  for (const storage of [() => { throw new Error("disabled"); }, () => ({ getItem() { return null; }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("disabled"); } })]) {
    const prefs = createFilterPreferences({ userId: "alice", storage });
    assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
    prefs.remember(parseRoute("#/jobs?company=Acme"));
    assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "company=Acme");
    prefs.remember(parseRoute(filterHref("#/jobs")));
    assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
  }
});

test("bulk preview preferences are allowlisted and exclude matching settings, selection and action state", () => {
  const query = "search=Front&company=Acme&eligibility=ELIGIBLE&pageSize=100&selected=all&matchingMode=SUBCATEGORY&confirmed=true&ticket=secret&resumeIds=private&page=4";
  const saved = savedFilterQuery(query, parseBulkPreviewQuery);
  assert.equal(saved, "search=Front&company=Acme&eligibility=ELIGIBLE&pageSize=100");
});
