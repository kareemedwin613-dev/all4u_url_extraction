import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Activity Log API remains available outside dashboard navigation", async () => {
  const [app, router, access, service, page, migration, migrationV33] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/router.js"),
    read("../src/access/route-access.js"),
    read("../src/services/activity-log-service.js"),
    read("../src/pages/activity-log-page.jsx"),
    read("../../supabase/migrations/202608280092_v3_32_admin_activity_log.sql"),
    read("../../supabase/migrations/202608280093_v3_33_user_activity_events.sql"),
  ]);

  assert.doesNotMatch(router, /admin-activity-log/);
  assert.doesNotMatch(access, /admin-activity-log/);
  assert.doesNotMatch(access, /Activity Log/);
  assert.doesNotMatch(app, /ActivityLogPage/);
  assert.match(service, /\/api\/v1\/admin\/activity-log/);
  assert.match(service, /listActivityLog/);
  assert.match(page, /Activity Log/);
  assert.match(page, /DataPagination/);
  assert.match(page, /data=\{paginationData\}/);
  assert.match(page, /tableHostRef/);
  assert.match(page, /dataIndex: "ip_address"/);
  assert.match(service, /USER_LOGIN/);
  assert.match(migration, /list_admin_activity_log_v32/);
  assert.match(migrationV33, /list_admin_activity_log_v33/);
  assert.match(migrationV33, /USER_LOGIN/);
  assert.match(migration, /application_status_history/);
  assert.match(migration, /application_screenshots/);
  assert.match(migration, /application_extension_sessions/);
  assert.match(migration, /application_assignment_history/);
});
