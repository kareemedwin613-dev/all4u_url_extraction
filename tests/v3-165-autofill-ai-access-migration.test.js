import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/202610091000_v3_165_autofill_ai_applier_access.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../extension/sidepanel/App.jsx", import.meta.url), "utf8");

test("v3.165 keeps AI access and per-person usage behind RLS, counts only", () => {
  for (const table of ["autofill_ai_access", "autofill_ai_access_history", "autofill_ai_usage_user_hourly"]) {
    assert.match(sql, new RegExp(`alter table public\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\.${table} from public, anon, authenticated`));
  }
  const usage = sql.match(/create table if not exists public\.autofill_ai_usage_user_hourly \(([\s\S]*?)\n\);/)[1];
  assert.doesNotMatch(usage, /question text|answer text|candidate|resume_id/i, "no questions, answers or candidate data per person");
});

test("v3.165 everyone starts at Off; only Admins change access, and every change is kept", () => {
  assert.match(sql, /level text not null check \(level in \('MATCH', 'DRAFT'\)\)/, "no row means OFF");
  assert.match(sql, /coalesce\(\(select a\.level from public\.autofill_ai_access a where a\.user_id = p_user_id\), 'OFF'\)/);
  assert.doesNotMatch(sql, /insert into public\.autofill_ai_access\(user_id[^;]*select/i, "nobody is granted access by the migration");
  const setter = sql.slice(sql.indexOf("create or replace function public.set_autofill_ai_access_v3165"));
  assert.match(setter, /public\.has_role\('ADMIN', auth\.uid\(\)\)/);
  assert.match(setter, /insert into public\.autofill_ai_access_history/);
  assert.match(sql, /revoke all on function public\.autofill_ai_add_user_usage_v3165\(uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.autofill_ai_level_v3165\(uuid\) from public, anon, authenticated;/);
});

test("v3.165 the caller's level reaches the API with the lookup and the drafting context", () => {
  assert.equal((sql.match(/'aiLevel', public\.autofill_ai_level_v3165\(auth\.uid\(\)\)/g) || []).length, 2);
  assert.equal((sql.match(/set ai_used_at = now\(\) where id = p_session_id and ai_used_at is null/g) || []).length, 2, "a run counts once, whichever AI call comes first");
});

test("the side panel does not ask for drafts when the person's access is not DRAFT", () => {
  assert.match(app, /const mayDraft = !recognized\?\.aiLevel \|\| recognized\.aiLevel === "DRAFT";/);
  assert.match(app, /const draftable = \(recovered \|\| reviewRequired \|\| !mayDraft\) \? \[\] :/);
});
