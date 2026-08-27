import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeApplierProfileWorkload } from "../src/features/overview/applier-profile-workload.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Applier Overview shows My Profile Workload instead of manager performance charts", async () => {
  const [app, chart, model, sql, sqlLatest, service, controller] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-profile-workload-chart.jsx"),
    read("../src/features/overview/applier-profile-workload.js"),
    read("../../supabase/migrations/202608270082_v3_22_applier_profile_workload_blocked.sql"),
    read("../../supabase/migrations/202608270083_v3_23_admin_all_profile_workload.sql"),
    read("../../apps/api/src/applications/application.service.ts"),
    read("../../apps/api/src/applications/application.controller.ts"),
  ]);
  assert.match(app, /showProfileWorkload/);
  assert.match(app, /USER_ADMIN/);
  assert.match(app, /title=\{isAdmin \? "Profile Workload" : "My Profile Workload"\}/);
  assert.match(app, /<ApplierProfileWorkloadChart/);
  assert.match(chart, /aria-label=\{`Search \$\{title\}/);
  assert.match(chart, /from "recharts"/);
  assert.match(chart, /BarChart/);
  for (const label of ["Total", "Applied", "Pending", "Blocked"]) {
    assert.match(model, new RegExp(label));
  }
  assert.match(sql, /blocked_count/);
  assert.match(sqlLatest, /v_admin boolean/);
  assert.match(sqlLatest, /v_admin or arp\.applier_user_id = auth\.uid\(\)/);
  assert.match(sqlLatest, /applier_name/);
  assert.match(service, /get_applier_resume_profile_workload_v31/);
  assert.match(controller, /profile-workload/);
  assert.match(controller, /RequireRoles\("APPLIER","ADMIN"\)/);
});

test("normalizeApplierProfileWorkload maps overview rows for the profile chart", () => {
  const [row] = normalizeApplierProfileWorkload([
    {
      id: "r1",
      profile_name: "Michael Baqadi",
      resume_name: "Michael Baqadi Resume",
      applier_name: "Sami Ullah",
      total_count: 40,
      applied_count: 12,
      pending_count: 18,
      blocked_count: 4,
    },
  ]);
  assert.deepEqual(row, {
    id: "r1",
    name: "Michael Baqadi",
    resumeName: "Michael Baqadi Resume",
    applierName: "Sami Ullah",
    total: 40,
    applied: 12,
    pending: 18,
    blocked: 4,
  });
});
