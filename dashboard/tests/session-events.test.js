import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("login/IP tracking is wired across API, migration, and clients", async () => {
  const [
    migration,
    platformService,
    sessionController,
    dashboardService,
    extensionService,
    app,
    extensionApp,
    activityPage,
    activityService,
  ] = await Promise.all([
    read("../../supabase/migrations/202608280093_v3_33_user_activity_events.sql"),
    read("../../apps/api/src/platform/platform.service.ts"),
    read("../../apps/api/src/auth/session-events.controller.ts"),
    read("../src/services/session-events-service.js"),
    read("../../extension/services/session-events-service.js"),
    read("../src/App.jsx"),
    read("../../extension/sidepanel/App.jsx"),
    read("../src/pages/activity-log-page.jsx"),
    read("../src/services/activity-log-service.js"),
  ]);

  assert.match(migration, /user_activity_events/);
  assert.match(migration, /record_user_activity_event_v33/);
  assert.match(migration, /list_admin_activity_log_v33/);
  assert.match(migration, /USER_LOGIN/);
  assert.match(migration, /ip_address text/);
  assert.match(platformService, /list_admin_activity_log_v33/);
  assert.match(sessionController, /session-events/);
  assert.match(sessionController, /recordLogin/);
  assert.match(dashboardService, /\/api\/v1\/session-events\/login/);
  assert.match(dashboardService, /clientType/);
  assert.match(extensionService, /\/api\/v1\/session-events\/login/);
  assert.match(app, /recordLogin\(client, apiBaseUrl, "DASHBOARD"\)/);
  assert.match(extensionApp, /recordLogin\(client, backendBaseUrl, "EXTENSION"\)/);
  assert.match(activityPage, /dataIndex: "ip_address"/);
  assert.match(activityService, /USER_LOGIN/);
});
