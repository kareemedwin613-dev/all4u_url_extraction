import test from "node:test";
import assert from "node:assert/strict";
import { createFilterPreferences, filterHref, parsePeriodQuery, periodFromFilterQuery, parseBulkPreviewQuery, savedFilterQuery } from "../src/shared/filter-preferences.js";
import { overviewDateBounds } from "../src/features/overview/overview-date.js";
import { parseRoute } from "../src/router.js";

const id = "f3a34ffd-d66a-49f7-815e-c7786857576b";
function setup() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const store = (userId = "alice", apiBaseUrl = "https://api.test") => createFilterPreferences({ userId, apiBaseUrl, storage: () => storage });
  return { data, store };
}

test("filter preferences are not persisted across navigation or sessions", () => {
  const { store, data } = setup();
  const query = new URLSearchParams({ company: "Acme", jobTitle: "Engineer", page: "8", pageSize: "100" });
  store().remember(parseRoute(`#/jobs?${query}`));
  assert.equal(store().resolve(parseRoute("#/jobs")).query, "");
  assert.equal(data.size, 0);
});

test("each account and API environment still gets an independent scope", () => {
  const { store } = setup();
  assert.notEqual(store("alice").scope, store("bob").scope);
  assert.notEqual(store("alice", "https://api.test").scope, store("alice", "http://localhost:3000").scope);
  assert.equal(store("alice", "https://api.test/").scope, store("alice", "https://api.test").scope);
});

test("explicit links keep their own query and are never merged with remembered filters", () => {
  const { store } = setup(), prefs = store();
  prefs.remember(parseRoute("#/jobs?company=Old&reviewStatus=APPROVED&pageSize=100"));
  const link = parseRoute("#/jobs?seniority=SENIOR&page=3");
  assert.equal(prefs.resolve(link), link);
  assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
});

test("clear-filter links remain stable without resurrecting stored preferences", () => {
  const { store } = setup(), prefs = store();
  prefs.remember(parseRoute("#/jobs?company=Acme"));
  const reset = parseRoute(filterHref("#/jobs"));
  assert.equal(prefs.resolve(reset), reset);
  prefs.remember(reset);
  assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
});

test("workflow and authentication URLs are never persisted", () => {
  const { store, data } = setup(), prefs = store();
  for (const url of ["#/login?ticket=secret", "#/profile?token=secret", "#/applications/bulk-create?draft=secret", `#/applications/${id}?ticket=secret`, `#/tailoring-jobs/${id}?ticket=secret`]) {
    const route = parseRoute(url);
    prefs.remember(route); assert.equal(prefs.resolve(route), route);
  }
  assert.equal(data.size, 0);
});

test("relative date presets roll forward; custom dates parse exactly and labels regenerate", () => {
  const period = periodFromFilterQuery("window=THIS_WEEK&from=2020-01-01&label=stale");
  assert.equal(period.label, "This Week"); assert.equal(period.from, "");
  const earlier = overviewDateBounds(period, new Date(2026, 8, 14)), later = overviewDateBounds(period, new Date(2026, 8, 21));
  assert.notEqual(earlier.from, later.from);
  const query = "window=CUSTOM&from=2026-09-01&to=2026-09-18";
  assert.equal(periodFromFilterQuery(query).label, "Sep 1, 2026 - Sep 18, 2026");
});

test("invalid filter values fall back safely", () => {
  for (const query of ["window=BOGUS", "window=CUSTOM&from=2026-02-30&to=2026-03-01", "window=CUSTOM&from=2026-09-20&to=2026-09-01", "window=CUSTOM&from=2020-01-01&to=2026-09-01"]) {
    assert.deepEqual(parsePeriodQuery(query), parsePeriodQuery(""));
  }
});

test("disabled storage does not break navigation when persistence is off", () => {
  for (const storage of [() => { throw new Error("disabled"); }, () => ({ getItem() { return null; }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("disabled"); } })]) {
    const prefs = createFilterPreferences({ userId: "alice", storage });
    assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
    prefs.remember(parseRoute("#/jobs?company=Acme"));
    assert.equal(prefs.resolve(parseRoute("#/jobs")).query, "");
  }
});

test("bulk preview preferences are allowlisted and exclude matching settings, selection and action state", () => {
  const query = "search=Front&company=Acme&eligibility=ELIGIBLE&pageSize=100&selected=all&matchingMode=SUBCATEGORY&confirmed=true&ticket=secret&resumeIds=private&page=4";
  const saved = savedFilterQuery(query, parseBulkPreviewQuery);
  assert.equal(saved, "search=Front&company=Acme&eligibility=ELIGIBLE&pageSize=100");
});
