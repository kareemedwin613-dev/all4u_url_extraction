import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("shared tabbed sections preserve content and provide keyboard navigation", async () => {
  const source = await read("../src/components/ui.jsx");
  assert.match(source, /export function TabbedSections/);
  assert.match(source, /event\.altKey/);
  assert.match(source, /Number\(event\.key\)-1|Number\(event\.key\) - 1/);
  assert.match(source, /destroyOnHidden=\{false\}/);
  assert.match(source, /arrow keys/);
});

test("long detail and workflow pages use compact tabbed layouts", async () => {
  const [app, applications, admin, bulk, upload] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/applications/application-pages.jsx"),
    read("../src/pages/admin-pages.jsx"),
    read("../src/features/bulk-applications/bulk-pages.jsx"),
    read("../src/features/resume-upload/resume-upload-page.jsx"),
  ]);
  assert.ok(
    (app.match(/<TabbedSections/g) || []).length >= 2,
    "JD and Resume details are tabbed",
  );
  assert.match(applications, /label="Overview"|label: "Overview"/);
  for (const label of ["Progress", "Assignment", "History"])
    assert.match(applications, new RegExp(`label[=:] ["']${label}`));
  for (const label of ["Identity", "Account status", "System roles"])
    assert.match(admin, new RegExp(`label: ["']${label}`));
  assert.match(bulk, /Review combinations/);
  assert.match(bulk, /Create selected/);
  assert.match(upload, /Personal & classification/);
  assert.match(upload, /Structured Resume/);
  assert.match(upload, /Original text/);
});

test("primary paginated tables use bounded viewport scrolling", async () => {
  const sources = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/applications/application-pages.jsx"),
    read("../src/pages/admin-pages.jsx"),
    read("../src/features/bulk-applications/bulk-pages.jsx"),
  ]);
  for (const source of sources) assert.match(source, /y: "calc\(100vh - /);
});
