import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Applier Detail route and page are wired for admin scorecard access", async () => {
  const [app, router, access, page, service, table, main] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/router.js"),
    read("../src/access/route-access.js"),
    read("../src/features/appliers/applier-detail-page.jsx"),
    read("../src/features/appliers/applier-detail-service.js"),
    read("../src/features/overview/applier-productivity-table.jsx"),
    read("../src/main.jsx"),
  ]);

  assert.match(router, /applier-detail/);
  assert.match(access, /"applier-detail": CAPABILITIES\.USER_ADMIN/);
  assert.match(app, /ApplierDetailPage/);
  assert.match(app, /route\.name === "applier-detail"/);
  assert.match(page, /ApplierDetailPage/);
  assert.match(page, /loadApplierDetail/);
  assert.match(page, /OverviewKpiGrid/);
  assert.match(page, /ApplierProfileWorkloadChart/);
  assert.match(page, /Activity Timeline/);
  assert.match(page, /loadMoreActivity/);
  assert.match(page, /Performance Grade/);
  assert.match(service, /loadApplierActivity/);
  assert.match(service, /\/api\/v1\/admin\/appliers\//);
  assert.match(service, /scorecard/);
  assert.match(service, /normalizeApplierProductivity/);
  assert.match(table, /#\/appliers\//);
  assert.match(main, /applier-detail\.css/);
});
