import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("bulk cancel applications RPC is manager-only and returns per-row results", async () => {
  const [sql, controller, service] = await Promise.all([
    read("../../supabase/migrations/202608310098_v3_38_bulk_cancel_applications.sql"),
    read("../../apps/api/src/applications/application.controller.ts"),
    read("../../apps/api/src/applications/application.service.ts"),
  ]);
  assert.match(sql, /bulk_cancel_applications_v315/);
  assert.match(sql, /assert_application_manager/);
  assert.match(sql, /status = 'CANCELLED'/);
  assert.match(sql, /application_status_history/);
  assert.match(controller, /bulk-cancel/);
  assert.match(service, /bulk_cancel_applications_v315/);
});
