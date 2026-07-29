import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202607290025_v0_8_9_application_autofill_context.sql", import.meta.url), "utf8");

test("v0.8.9 context is Application/session authorized and Resume-owned", () => {
  assert.match(sql, /get_application_autofill_context_v089/);
  assert.match(sql, /application_extension_sessions/);
  assert.match(sql, /s\.user_id=auth\.uid\(\)/);
  assert.match(sql, /s\.action='AUTOFILL'/);
  assert.match(sql, /application_actor_can_view\(a\.assigned_to\)/);
  assert.match(sql, /r\.profile_review_status/);
  assert.match(sql, /PROFILE_REVIEW_REQUIRED/);
  assert.match(sql, /AUTOFILL_CONTEXT_STALE/);
  assert.match(sql, /PROFILE_REVIEW_REQUIRED: Verify this Resume''s Autofill Metadata/);
  assert.match(sql, /APPLICATION_JOB_URL_UNAVAILABLE/);
  assert.match(sql, /create_application_extension_session_v085/);
  assert.match(sql, /p_expected_resume_updated_at/);
  assert.match(sql, /grant execute .* to authenticated/i);
  assert.doesNotMatch(sql, /create table public\.candidate/i);
  assert.doesNotMatch(sql, /resume_text|storage_path|file_sha256/i);
});
