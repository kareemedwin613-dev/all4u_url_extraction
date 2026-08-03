import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = (await readFile(new URL("../supabase/migrations/202608020032_v0_9_4_autofill_session_feedback.sql", import.meta.url), "utf8")).toLowerCase();

test("v0.9.4 extends the existing session audit and adds bounded field outcomes", () => {
  assert.match(sql, /alter table public\.application_extension_sessions/);
  for (const column of ["resume_id_snapshot", "resume_updated_at_snapshot", "adapter_id", "adapter_version", "target_domain", "detected_count", "selected_count", "succeeded_count", "failed_count", "unresolved_count"]) assert.match(sql, new RegExp(`add column ${column}`));
  assert.match(sql, /create table public\.application_extension_session_fields/);
  assert.match(sql, /outcome in \('detected','verified','failed','skipped'\)/);
  assert.match(sql, /confidence between 0 and 100/);
});

test("v0.9.4 feedback is RLS protected and writable only through the authenticated RPC", () => {
  assert.match(sql, /alter table public\.application_extension_session_fields enable row level security/);
  assert.match(sql, /s\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /application_actor_can_view\(a\.assigned_to\)/);
  assert.match(sql, /revoke insert, update, delete on public\.application_extension_session_fields from authenticated/);
  assert.match(sql, /grant execute on function public\.record_application_autofill_telemetry_v094\([^)]+\) to authenticated/);
  assert.doesNotMatch(sql, /service_role/);
});

test("v0.9.4 rejects sensitive telemetry payload keys", () => {
  assert.match(sql, /autofill_telemetry_sensitive_data/);
  for (const forbidden of ["'value'", "'questiontext'", "'resumetext'", "'signedurl'", "'token'"]) assert.match(sql, new RegExp(forbidden));
  assert.doesNotMatch(sql, /create table public\.autofill_sessions/);
});
