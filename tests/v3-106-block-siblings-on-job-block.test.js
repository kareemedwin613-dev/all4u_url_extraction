import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/202609211800_v3_106_block_siblings_on_job_block.sql", import.meta.url),
  "utf8",
);

test("v3106 blocks sibling Applications instead of cancelling them", () => {
  assert.match(sql, /block_sibling_applications_for_blocked_job_v3106/);
  assert.match(sql, /v_siblings_blocked := public\.block_sibling_applications_for_blocked_job_v3106/);
  assert.match(sql, /'siblings_blocked', v_siblings_blocked/);
  assert.match(sql, /new_status, changed_by, notes\s*\) values \(\s*v_updated\.id, 'STATUS', v_sibling\.status, 'BLOCKED'/);
  assert.match(sql, /Blocked because this job was blocked for all profiles:/);
});

test("v3106 repairs prior cascade-cancelled Applications on blocked JDs", () => {
  assert.match(sql, /Cancelled because this job was blocked for all profiles:/);
  assert.match(sql, /a\.status = 'CANCELLED'/);
  assert.match(sql, /status = 'BLOCKED'/);
  assert.match(sql, /insert into public\.application_status_history/);
});

test("API and UI say siblings become Blocked", () => {
  const service = readFileSync(new URL("../apps/api/src/applications/application.service.ts", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../extension/sidepanel/components/ApplicationStatusModal.jsx", import.meta.url), "utf8");
  const progress = readFileSync(new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url), "utf8");
  assert.match(service, /siblingsBlocked/);
  assert.match(modal, /will be set to Blocked/);
  assert.match(modal, /other open Application\$\{siblingsBlocked === 1 \? "" : "s"\} blocked\./);
  assert.match(progress, /will be set to Blocked/);
  assert.match(progress, /other open Application\$\{siblingsBlocked === 1 \? "" : "s"\} blocked\./);
});
