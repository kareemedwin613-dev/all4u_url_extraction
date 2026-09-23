import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import React, { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createBulkDraftStore } from "../src/features/bulk-applications/bulk-drafts.js";

// Exercise the real page, hooks, draft persistence and API client. Replace only
// the visual widgets so this test doesn't depend on browser layout/CSS support.
const widgetStubs = `
import React from 'react';
const h = React.createElement, controls = () => globalThis.bulkNavigationControls;
export const Box = p => h('div', null, p.title, p.message, p.description, p.extra, p.action, p.children);
export const Alert = Box, Card = Box, Col = Box, Empty = Box, Flex = Box, Row = Box, Space = Box, Tag = Box, Pagination = Box;
export const Statistic = p => h('div', null, p.title + ': ' + p.value);
export const Progress = p => h('div', { role: 'progressbar', 'aria-label': p['aria-label'], 'aria-valuenow': p.percent, 'data-status': p.status });
export const Form = Object.assign(Box, { Item: Box });
export const Typography = { Text: Box, Title: Box };
export const App = { useApp: () => ({ modal: { confirm: value => { controls().confirm = value; } }, message: {} }) };
export const Button = p => {
  if (typeof p.children === 'string') controls().buttons.set(p.children, p);
  return h('button', { onClick: p.onClick, disabled: p.disabled }, p.children);
};
export const Input = Object.assign(p => { if (p.showCount) controls().name = p; return null; }, { Search: () => null });
export const Select = p => { if (p.mode === 'multiple') controls().resumes = p; return null; };
export const Result = p => { controls().result = p; return h(Box, p); };
export const Popconfirm = p => h(Box, p);
export const Table = p => { if (p.rowKey === 'key' && p.rowSelection) controls().pairs = p; return null; };
export const ErrorState = Box, FilterPanel = Box, LoadingState = Box, PageHeading = Box, StatusTag = Box;
export const TabbedSections = p => { controls().tabs = p; return p.items.find(item => item.key === p.activeKey)?.children || null; };
export const MatchingModeSelect = p => { controls().mode = p; return null; };
export const MatchScore = Box, MatchingRunnerCommand = Box;
export const firstFilterValue = () => '', searchFilterIcon = () => null, serverSideColumnFilter = () => ({}), textSearchFilterDropdown = () => null;
`;
const compiled = await build({
  stdin: { contents: 'export { BulkCreateWorkspace } from "./features/bulk-applications/bulk-pages.jsx"; export { TailoringBatchDetailPage } from "./features/tailoring/tailoring-batch-pages.jsx";',
    resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), sourcefile: "batch-workflows-test.jsx", loader: "jsx" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", define: { "import.meta.env": "{}" },
  plugins: [{ name: "visual-widgets", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, args => ({ path: args.path, external: true }));
    builder.onResolve({ filter: /^(antd|.*\/components\/ui\.jsx|.*\/match-components\.jsx|.*\/column-filters\.jsx)$/ }, () => ({ path: "widgets", namespace: "test-widgets" }));
    builder.onLoad({ filter: /.*/, namespace: "test-widgets" }, () => ({ contents: widgetStubs, loader: "js" }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { BulkCreateWorkspace, TailoringBatchDetailPage } = module.exports;

const jd = "f3a34ffd-d66a-49f7-815e-c7786857576b", otherJd = "b4d63a80-e306-4a2f-afca-29cd4b3951e0";
const r1 = "8660f115-ce73-41ff-889b-b6d07202a3e4", r2 = "a21c0738-2905-4733-8a1d-d6e0dddb0122";
const row = (jobDescriptionId, resumeId, eligible = true) => ({ key: `${jobDescriptionId}:${resumeId}`, jobDescriptionId, resumeId, resumeType: "ORIGINAL", eligible,
  matchStatus: eligible ? "COMPLETED" : "PROCESSING", exclusionCode: eligible ? null : "MATCH_PROCESSING", candidateName: resumeId, resumeName: "Original" });

async function setup(t) {
  const previous = Object.fromEntries(["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT", "bulkNavigationControls"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true, bulkNavigationControls: { buttons: new Map() } });
  const controls = globalThis.bulkNavigationControls, data = new Map(), calls = [];
  const storage = { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const newStore = () => createBulkDraftStore({ userId: "tester", apiBaseUrl: "https://api.example.test", storage: () => storage });
  let previewRows = [row(jd, r1), row(jd, r2), row(otherJd, r1, false)], createError = false, creationGate, previewError = false, truncated = false, tailoringData, tailoringError = false;
  globalThis.fetch = async (url, options) => {
    const request = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(request);
    if (url.includes("/tailoring-batches/")) return tailoringError
      ? new Response(JSON.stringify({ error: { code: "DATABASE_ERROR", message: "Preview unavailable" } }), { status: 400 })
      : new Response(JSON.stringify({ data: tailoringData }));
    if (url.endsWith("/bulk-preview")) {
      if (previewError) return new Response(JSON.stringify({ error: { code: "PREVIEW_FAILED", message: "Preview unavailable" } }), { status: 400 });
      const combinations = previewRows.filter(item => request.body.resumeIds === undefined || request.body.resumeIds.includes(item.resumeId));
      return new Response(JSON.stringify({ data: { combinations, truncated, matchingMode: request.body.matchingMode, matchingConfigured: true, resumeOptions: [row(jd, r1), row(jd, r2)] } }));
    }
    if (url.endsWith("/application-matches")) return new Response(JSON.stringify({ data: { runner: { ticket: "test-only-ticket" } } }));
    if (url.endsWith("/bulk-create")) {
      if (creationGate) await creationGate;
      if (createError) throw new Error("Failed to fetch");
      return new Response(JSON.stringify({ data: { batchId: jd, createdCount: 1, duplicateCount: 0, skippedCount: 0, failedCount: 0, results: [] } }));
    }
    throw new Error(`Unexpected API endpoint: ${url}`);
  };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test-only" } } }) } }, root = createRoot(document.getElementById("root"));
  function Harness({ store, id, visible }) {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    return visible ? React.createElement(BulkCreateWorkspace, { key: id, client, apiBaseUrl: "https://api.example.test", query: `draft=${id}`, draftStore: store, ...snapshot }) : React.createElement("div", null, "Another page");
  }
  const step = async action => act(async () => { await action(); await new Promise(resolve => setImmediate(resolve)); });
  const render = (store, id, visible = true) => step(() => root.render(React.createElement(Harness, { store, id, visible })));
  t.after(async () => {
    await act(() => root.unmount());
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { controls, calls, data, newStore, render, step, setRows: rows => { previewRows = rows; }, failCreation: () => { createError = true; },
    setTailoringData: value => { tailoringData = value; }, failTailoring: value => { tailoringError = value; },
    renderTailoring: id => step(() => root.render(React.createElement(TailoringBatchDetailPage, { key: id, id, client, apiBaseUrl: "https://api.example.test" }))),
    failPreview: value => { previewError = value; }, truncatePreview: () => { truncated = true; },
    delayCreation: () => { let finish; creationGate = new Promise(resolve => { finish = resolve; }); return finish; } };
}

test("leave category creation, reload the saved draft, then create using fresh eligibility", async t => {
  const h = await setup(t), store = h.newStore(), draft = store.create([jd, otherJd]);
  await h.render(store, draft.id);
  assert.equal(h.calls.length, 1, "initial preview is not fetched twice");
  assert.equal(document.querySelector('[role="progressbar"]'), null);
  await h.step(() => h.controls.resumes.onChange([r1]));
  await h.step(() => h.controls.pairs.rowSelection.onSelect(row(jd, r1), false));
  await h.step(() => h.controls.tabs.onChange("create"));
  await h.step(() => h.controls.name.onChange({ target: { value: "Resume this batch" } }));
  assert.equal(h.controls.buttons.has("Create / resume scoring command"), false);
  await h.render(store, draft.id, false);
  h.setRows([row(jd, r1), row(jd, r2), row(otherJd, r1)]);
  const reloaded = h.newStore();
  await h.render(reloaded, draft.id);
  assert.equal(document.querySelector('[role="progressbar"]'), null);
  assert.equal(h.controls.name.value, "Resume this batch");
  assert.equal(h.controls.tabs.activeKey, "create");
  assert.deepEqual(h.controls.resumes.value, [r1]);
  assert.equal(h.calls.filter(call => call.url.endsWith("/application-matches")).length, 0, "category creation never queues scoring");
  await h.step(() => h.controls.tabs.onChange("combinations"));
  assert.deepEqual(h.controls.pairs.rowSelection.selectedRowKeys, [`${otherJd}:${r1}`], "manual exclusion survives while newly passing score is selected");
  assert.doesNotMatch([...h.data.values()].join(""), /test-only-ticket/);
  await h.step(() => h.controls.tabs.onChange("create"));
  await h.step(() => h.controls.buttons.get("Create Applications").onClick());
  await h.step(() => h.controls.confirm.onOk());
  const created = h.calls.find(call => call.url.endsWith("/bulk-create"));
  assert.deepEqual(created.body.combinations, [{ jobDescriptionId: otherJd, resumeId: r1 }]);
  assert.equal(created.body.batchName, "Resume this batch");
  assert.equal(reloaded.getSnapshot().drafts.length, 0);
  assert.equal(h.controls.result.title, "Bulk creation completed");
});

test("category mode and an empty resume selection survive navigation without starting AI", async t => {
  const h = await setup(t), store = h.newStore(), draft = store.create([jd]);
  await h.render(store, draft.id);
  await h.step(() => h.controls.mode.onChange("CATEGORY"));
  await h.step(() => h.controls.resumes.onChange([]));
  await h.render(store, draft.id, false);
  await h.render(h.newStore(), draft.id);
  assert.equal(h.controls.mode.value, "CATEGORY");
  assert.deepEqual(h.controls.resumes.value, []);
  assert.deepEqual(h.controls.pairs.rowSelection.selectedRowKeys, []);
  assert.ok(h.calls.every(call => call.url.endsWith("/bulk-preview")));
  assert.equal(h.calls.at(-1).body.matchingMode, "CATEGORY");
  assert.deepEqual(h.calls.at(-1).body.resumeIds, []);
  assert.equal(document.querySelector('[role="progressbar"]'), null);
});

test("failed submission keeps the draft and reuses its idempotency key after navigation", async t => {
  const h = await setup(t), store = h.newStore(), draft = store.create([jd]);
  h.setRows([row(jd, r1)]); h.failCreation();
  await h.render(store, draft.id);
  await h.step(() => h.controls.tabs.onChange("create"));
  await h.step(() => h.controls.buttons.get("Create Applications").onClick());
  await h.step(() => h.controls.confirm.onOk());
  assert.equal(store.getSnapshot().drafts.length, 1);
  await h.render(store, draft.id, false);
  await h.render(h.newStore(), draft.id);
  await h.step(() => h.controls.buttons.get("Create Applications").onClick());
  await h.step(() => h.controls.confirm.onOk());
  const attempts = h.calls.filter(call => call.url.endsWith("/bulk-create"));
  assert.equal(attempts.length, 2);
  assert.ok(attempts[0].headers["Idempotency-Key"]);
  assert.equal(attempts[0].headers["Idempotency-Key"], attempts[1].headers["Idempotency-Key"]);
});

test("creation finishing after navigation removes only its draft without disturbing the next one", async t => {
  const h = await setup(t), store = h.newStore(), first = store.create([jd]), second = store.create([otherJd]);
  h.setRows([row(jd, r1)]);
  const finish = h.delayCreation();
  await h.render(store, first.id);
  await h.step(() => h.controls.tabs.onChange("create"));
  await h.step(() => h.controls.buttons.get("Create Applications").onClick());
  let submission;
  await h.step(() => { submission = h.controls.confirm.onOk(); });
  await h.render(store, second.id);
  await h.step(() => h.controls.tabs.onChange("create"));
  await h.step(() => h.controls.name.onChange({ target: { value: "Keep this draft" } }));
  await h.step(async () => { finish(); await submission; });
  assert.deepEqual(store.getSnapshot().drafts.map(draft => draft.id), [second.id]);
  assert.equal(h.controls.name.value, "Keep this draft");
  assert.equal(h.controls.result, undefined, "the old request doesn't replace the new page with its result");
});

test("a missing draft URL never falls back to another draft or starts API work", async t => {
  const h = await setup(t), store = h.newStore();
  store.create([jd]);
  await h.render(store, crypto.randomUUID());
  assert.equal(h.calls.length, 0);
  assert.match(document.body.textContent, /no longer available/);
  assert.match(document.body.textContent, /In-progress creation drafts/);
});

test("category workflow hides archived evaluation progress and does not poll pending scores", async t => {
  const h = await setup(t), store = h.newStore(), draft = store.create([jd]);
  h.setRows([row(jd, r1, false)]);
  const schedule = globalThis.setTimeout, scheduled = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    scheduled.push(delay);
    return schedule(callback, delay, ...args);
  };
  t.after(() => { globalThis.setTimeout = schedule; });
  await h.render(store, draft.id);
  assert.equal(h.controls.mode.value, "CATEGORY");
  assert.equal(document.querySelector('[role="progressbar"]'), null);
  assert.equal(h.controls.buttons.has("Create / resume scoring command"), false);
  assert.equal(scheduled.includes(5000), false, "pending historical scores must not start polling");
  assert.equal(h.calls.length, 1);
  h.setRows([row(jd, r1)]);
  await h.step(() => h.controls.buttons.get("Refresh eligibility").onClick());
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.url.endsWith("/bulk-preview") && call.body.matchingMode === "CATEGORY"));
});

test("tailoring ETA uses recorded durations, parallelism and rate-limit/stale states", async t => {
  const h = await setup(t);
  const clock = 1_000_000;
  t.mock.method(Date, "now", () => clock);
  const items = [
    { id: "done", status: "COMPLETED", duration_ms: 40_000 },
    { id: "active-a", status: "PROCESSING", started_at: new Date(clock - 10_000).toISOString() },
    { id: "active-b", status: "PROCESSING", started_at: new Date(clock - 20_000).toISOString() },
    { id: "queued", status: "PENDING" },
  ];
  const batch = { id: jd, status: "RUNNING", selected_count: 4, completed_count: 1, pending_count: 1, processing_count: 2 };
  h.setTailoringData({ batch, items });
  await h.renderTailoring(jd);
  assert.match(document.body.textContent, /Estimated time remaining: ~1 min/);
  assert.match(document.body.textContent, /Average per resume: ~40 sec/);
  assert.match(document.body.textContent, /2 observed parallel job/);
  h.setTailoringData({ batch: { ...batch, status: "PAUSED_RATE_LIMIT" }, items });
  await h.step(() => h.controls.buttons.get("Refresh").onClick());
  assert.match(document.body.textContent, /Estimated time remaining: Paused/);
  h.failTailoring(true);
  await h.step(() => h.controls.buttons.get("Refresh").onClick());
  assert.match(document.body.textContent, /Estimated time remaining: Temporarily unavailable/);
  h.failTailoring(false);
  h.setTailoringData({ batch, items });
  await h.step(() => h.controls.buttons.get("Refresh").onClick());
  assert.match(document.body.textContent, /Estimated time remaining: ~1 min/);
  assert.doesNotMatch(document.body.textContent, /Temporarily unavailable/);
  h.setTailoringData({ batch: { ...batch, status: "CANCELLED" }, items });
  await h.step(() => h.controls.buttons.get("Refresh").onClick());
  assert.match(document.body.textContent, /Estimated time remaining: Cancelled/);
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls.every(call => call.url.includes("/tailoring-batches/")));
});
