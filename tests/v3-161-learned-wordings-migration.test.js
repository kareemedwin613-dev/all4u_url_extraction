import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/202610081000_v3_161_autofill_learned_wordings.sql", import.meta.url), "utf8");

test("v3.161 keeps learned wordings and AI spend behind RLS with no direct table access", () => {
  for (const table of ["autofill_learned_wordings", "autofill_ai_usage_hourly"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  const code = sql.replace(/--[^\n]*/g, "").replace(/comment on table[^;]*;/g, "");
  assert.doesNotMatch(code, /answer_value|candidate|resume_id|structured_content/i, "no answers or candidate data are stored");
});

test("v3.161 only the API's server key can save mappings; Appliers read through their own session", () => {
  assert.match(sql, /revoke all on function public\.save_autofill_learned_wordings_v3161\(uuid, uuid, text, jsonb, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.save_autofill_learned_wordings_v3161\(uuid, uuid, text, jsonb, jsonb\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute on function public\.save_autofill_learned_wordings_v3161[^;]*authenticated/);
  assert.match(sql, /s\.user_id = auth\.uid\(\) and s\.action = 'AUTOFILL' and s\.expires_at > now\(\)/, "lookup requires the caller's live Autofill session");
  assert.match(sql, /s\.user_id = p_user_id and s\.action = 'AUTOFILL'/, "save checks the session belongs to the authenticated Applier");
  assert.match(sql, /v_confidence < 80/, "unsure results are never saved");
  assert.match(sql, /autofill_learned_target_ok_v3161\(v_target\)/, "only real targets are saved");
  assert.match(sql, /public\.application_guide_admin\(\)/, "review and removal are Admin-only");
});

test("v3.161 limits writes: one usage update per wording per day, and six-month cleanup", () => {
  assert.match(sql, /filter \(where w\.last_used_on < current_date\)/);
  assert.match(sql, /last_used_on < current_date - 180 limit 200/);
  assert.match(sql, /'\[\.''’\]', '', 'g'/, "U.S. and US normalize the same");
});

test("v3.161 usage is hourly, counted once per page, and its report is Admin-only", () => {
  assert.match(sql, /usage_hour timestamptz primary key check \(usage_hour = date_trunc\('hour', usage_hour\)\)/);
  assert.match(sql, /insert into public\.autofill_ai_usage_hourly\(usage_hour, pages, questions_asked, questions_from_table\)/, "lookup counts the page and table hits");
  assert.match(sql, /insert into public\.autofill_ai_usage_hourly\(usage_hour, model_calls, questions_sent, input_tokens, output_tokens, cost_micro_usd\)/, "save adds model spend");
  assert.match(sql, /public\.is_active_user\(auth\.uid\(\)\) and public\.has_role\('ADMIN', auth\.uid\(\)\)/);
  assert.match(sql, /grant execute on function public\.autofill_ai_usage_report_v3161\(timestamptz, timestamptz\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.autofill_ai_month_cost_v3161\(\) from public, anon, authenticated;/);
});

test("v3.161 AI settings: one row, Admin-only read and save, every change kept, never a key", () => {
  assert.match(sql, /id boolean primary key default true check \(id\)/);
  assert.match(sql, /provider text not null check \(provider in \('openai', 'xai'\)\)/);
  assert.match(sql, /insert into public\.autofill_ai_settings_history\(changed_by, settings\)/);
  for (const name of ["get_autofill_ai_settings_v3161", "save_autofill_ai_settings_v3161"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${name}`), sql.indexOf("$$;", sql.indexOf(`create or replace function public.${name}`)));
    assert.match(body, /public\.has_role\('ADMIN', auth\.uid\(\)\)/, `${name} is Admin-only`);
  }
  const settingsTable = sql.slice(sql.indexOf("create table if not exists public.autofill_ai_settings ("), sql.indexOf(");", sql.indexOf("create table if not exists public.autofill_ai_settings (")));
  assert.doesNotMatch(settingsTable, /api_?key|secret|token|credential/i, "API keys are never stored");
  assert.match(sql, /'settings', public\.autofill_ai_settings_json_v3161\(\)\);/, "the Applier lookup carries the active settings");
});

test("v3.162 stores only the kind of a question without a standard answer, never an answer", () => {
  const v3162 = readFileSync(new URL("../supabase/migrations/202610082000_v3_162_learned_wording_answer_kind.sql", import.meta.url), "utf8");
  assert.match(v3162, /add column if not exists answer_kind text/);
  assert.match(v3162, /check \(answer_kind is null or answer_kind in \('SAME_FOR_EVERYONE', 'DEPENDS_ON_PROFILE', 'ESSAY', 'NOT_A_QUESTION'\)\)/);
  assert.match(v3162, /v_kind := case when v_target = 'none'/, "a matched question has no kind");
  assert.match(v3162, /'needsStandardAnswer', \(select count\(\*\)/);
  assert.match(v3162, /create or replace function public\.save_autofill_learned_wordings_v3161\(p_user_id uuid, p_session_id uuid, p_model text, p_items jsonb, p_usage jsonb\)/, "same signature: the server-key-only grant still applies");
});
