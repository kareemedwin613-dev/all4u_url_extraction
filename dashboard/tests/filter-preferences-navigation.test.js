import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { createFilterPreferences, filterHref, parseBulkPreviewQuery } from "../src/shared/filter-preferences.js";
import { FilterPageContext, FilterPreferencesContext, useRememberedRoute, useSavedFilters, useSavedSearch } from "../src/shared/use-filter-preferences.js";
import { parseRoute } from "../src/router.js";
import { useSavedTableSort } from "../src/shared/use-saved-table-sort.js";

async function setup(t) {
  const previous = Object.fromEntries(["window", "document", "history", "localStorage", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  const data = new Map(), replacements = [], loads = [], controls = {};
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  Object.assign(globalThis, { window, document, localStorage: storage, history: { replaceState: (_state, _title, url) => replacements.push(url) }, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById("root"));
  function Page({ route }) {
    const [search, setSearch] = useSavedSearch("chart"), [filters, setFilters] = useSavedFilters("preview", parseBulkPreviewQuery), [selected, setSelected] = useState([]);
    const tableSort = useSavedTableSort("table", [{ dataIndex: "company", sorter: () => 0 }, { children: [{ key: "status", sorter: () => 0 }] }, { key: "action" }]);
    Object.assign(controls, { route, search, setSearch, filters, setFilters, selected, setSelected, tableSort });
    useEffect(() => { loads.push({ path: route.path, query: route.query }); }, [route.path, route.query]);
    return React.createElement("div", null, route.path, search);
  }
  function Harness({ user = "alice", apiBaseUrl = "https://api.test", initialHash = "#/jobs" }) {
    const [rawRoute, setRawRoute] = useState(() => parseRoute(initialHash));
    const { route, store } = useRememberedRoute(rawRoute, setRawRoute, user, apiBaseUrl);
    controls.navigate = hash => setRawRoute(parseRoute(hash));
    return React.createElement(FilterPreferencesContext.Provider, { value: store },
      React.createElement(FilterPageContext.Provider, { value: route.path }, user ? React.createElement(Page, { key: `${store.scope}:${route.path}`, route }) : null));
  }
  const step = callback => act(async () => { callback(); await new Promise(resolve => setImmediate(resolve)); });
  const render = (props, strict = false) => step(() => root.render(strict
    ? React.createElement(React.StrictMode, null, React.createElement(Harness, props)) : React.createElement(Harness, props)));
  t.after(async () => {
    await act(() => root.unmount());
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { controls, data, loads, replacements, step, render, root,
    prefs: (userId = "alice", apiBaseUrl = "https://api.test") => createFilterPreferences({ userId, apiBaseUrl, storage: () => storage }) };
}

test("filters stay on the URL only and are not restored after navigation", async t => {
  const { prefs, render, controls, loads, replacements, step } = await setup(t);
  prefs().remember(parseRoute("#/jobs?company=Acme&page=5&pageSize=100"));
  await render();
  assert.deepEqual(loads, [{ path: "/jobs", query: "" }]);
  assert.equal(replacements.length, 0);
  await step(() => controls.navigate("#/jobs?company=Linked"));
  assert.equal(loads.at(-1).query, "company=Linked");
  await step(() => controls.navigate("#/resumes"));
  await step(() => controls.navigate("#/jobs"));
  assert.equal(loads.at(-1).query, "");
  await step(() => controls.navigate(filterHref("#/jobs")));
  assert.equal(loads.at(-1).query, "filters=default");
});

test("switching accounts or API environments does not hydrate previous filters", async t => {
  const { prefs, render, loads } = await setup(t);
  prefs().remember(parseRoute("#/jobs?company=Alice"));
  prefs("bob").remember(parseRoute("#/jobs?company=Bob"));
  await render(); assert.equal(loads.at(-1).query, "");
  await render({ user: "bob" }); assert.equal(loads.at(-1).query, "");
  await render({ user: null });
  await render({ user: "alice" }); assert.equal(loads.at(-1).query, "");
  assert.equal(prefs().resolve(parseRoute("#/jobs")).query, "");
});

test("local searches and preview filters reset when leaving the page; selected rows never persist", async t => {
  const { render, controls, step, root } = await setup(t);
  await render();
  await step(() => {
    controls.setSearch("Alex ");
    controls.setFilters(previous => ({ ...previous, eligibility: "ELIGIBLE" }));
    controls.setFilters(previous => ({ ...previous, pageSize: 100 }));
    controls.setSelected(["application-a"]);
  });
  assert.equal(controls.search, "Alex ");
  const originalFilters = controls.filters;
  await step(() => controls.setFilters(previous => ({ ...previous, pageSize: 100 })));
  assert.equal(controls.filters, originalFilters);
  await step(() => controls.navigate("#/resumes"));
  assert.equal(controls.search, ""); assert.equal(controls.filters.eligibility, "");
  await step(() => controls.navigate("#/jobs"));
  assert.equal(controls.search, ""); assert.equal(controls.filters.pageSize, 25);
  assert.equal(controls.filters.eligibility, ""); assert.deepEqual(controls.selected, []);
  await step(() => root.render(null)); await render();
  assert.equal(controls.search, ""); assert.deepEqual(controls.selected, []);
});

test("client-side table sorting is not restored after navigation and can be cleared", async t => {
  const { render, controls, step } = await setup(t);
  await render();
  await step(() => controls.tableSort.onSort({ field: "company", order: "ascend" }));
  assert.equal(controls.tableSort.columns[0].sortOrder, "ascend");
  await step(() => controls.navigate("#/resumes"));
  assert.equal(controls.tableSort.columns[0].sortOrder, null);
  await step(() => controls.navigate("#/jobs"));
  assert.equal(controls.tableSort.columns[0].sortOrder, null);
  await step(() => controls.tableSort.onSort([{ columnKey: "status", order: "descend" }]));
  assert.equal(controls.tableSort.columns[1].children[0].sortOrder, "descend");
  await step(() => controls.tableSort.resetSort());
  assert.equal(controls.tableSort.columns[1].children[0].sortOrder, null);
  await step(() => controls.tableSort.onSort({ field: "action", order: "ascend" }));
  assert.equal(controls.tableSort.columns[2].sortOrder, undefined);
});

test("StrictMode does not invent filter queries when persistence is off", async t => {
  const { prefs, render, loads, controls, step } = await setup(t);
  prefs().remember(parseRoute("#/jobs?company=Acme"));
  await render({}, true);
  assert.ok(loads.length > 0 && loads.length <= 2);
  assert.ok(loads.every(load => load.query === ""));
  await step(() => controls.setSearch("Alex"));
  await step(() => controls.navigate("#/resumes"));
  await step(() => controls.navigate("#/jobs"));
  assert.equal(controls.search, "");
  assert.equal(controls.route.query, "");
});
