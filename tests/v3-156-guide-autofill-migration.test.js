import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202610061600_v3_156_guide_driven_autofill.sql", import.meta.url), "utf8");
const functions = [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((match) => match[1]);

test("v3.156 functions are security definer with a fixed search_path and no anonymous access", () => {
  for (const name of functions) {
    const body = sql.slice(sql.indexOf(`function public.${name}(`));
    const header = body.slice(0, body.indexOf("$$"));
    assert.match(header, /set search_path\s*=\s*(public,pg_temp|'')/, `${name} pins search_path`);
    if (!/immutable security invoker/.test(header)) assert.match(header, /security definer/, `${name} runs as definer`);
  }
  for (const name of ["update_resume_gender_v3156", "save_application_guide_autofill_v3156", "get_application_autofill_context_v3156", "record_autofill_unresolved_questions_v3156", "list_autofill_unresolved_questions_v3156", "dismiss_autofill_unresolved_question_v3156"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public,anon;`), `${name} revoked from anon`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`), `${name} granted to authenticated`);
  }
  assert.match(sql, /revoke all on function public\.autofill_question_scrub_v3156\(text\) from public,anon,authenticated;/);
});

test("v3.156 unanswered-question tables are RPC-only with RLS and store no answers", () => {
  for (const table of ["autofill_unresolved_questions", "autofill_unresolved_question_sightings"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated;`));
  }
  const table = sql.slice(sql.indexOf("create table if not exists public.autofill_unresolved_questions"), sql.indexOf("create index if not exists autofill_unresolved_questions_open_idx"));
  assert.doesNotMatch(table, /\n\s+(answer|value|candidate|resume)\w*\s/i, "no column holds answers or candidate data");
  assert.match(sql, /autofill_question_scrub_v3156\(v_item->>'question'\)/, "question text is scrubbed of emails, links, and numbers");
  assert.match(sql, /s\.user_id=auth\.uid\(\) and s\.action='AUTOFILL'/, "only the session owner can record");
  assert.match(sql, /application_guide_admin\(\) then raise exception 'FORBIDDEN: Only an Admin can review/);
});

test("v3.156 Autofill context enforces review, consent, sensitive preferences, and parent-owned settings", () => {
  const context = sql.slice(sql.indexOf("create or replace function public.get_application_autofill_context_v3156"), sql.indexOf("-- 6. Unanswered questions"));
  assert.match(context, /join public\.resumes p on p\.id=coalesce\(r\.parent_resume_id,r\.id\)/);
  assert.match(context, /'mode',case when g\.autofill_sensitive and coalesce\(\(p\.autofill_preferences->>'prohibitSensitiveQuestions'\)::boolean,true\) then 'NEVER'/);
  assert.match(context, /'gender',case when coalesce\(\(p\.autofill_preferences->>'allowProfileFields'\)::boolean,false\) then p\.gender end/);
  assert.match(context, /'experienceDetails'/);
  assert.match(context, /PROFILE_REVIEW_REQUIRED/);
  assert.match(context, /AUTOFILL_CONSENT_REQUIRED/);
  assert.match(context, /AUTOFILL_CONTEXT_STALE/);
  assert.match(context, /g\.status='PUBLISHED' and g\.autofill_mode<>'NONE'/);
  assert.doesNotMatch(context, /resume_text|storage_path|signed_?url/i);
});

test("v3.156 widens field keys for guide answers and seeds the confirmed decisions", () => {
  assert.match(sql, /check \(field_key ~ '\^\(candidate\|screening\|employment\|education\|guide\)\\\./);
  assert.match(sql, /'I hereby state that the information','NEVER'/);
  assert.match(sql, /'What is your salary expectation','DERIVED','150000','salaryExpectation'/);
  assert.match(sql, /'Is your application being generated or submitted by AI','FIXED','No'/);
  for (const question of ["How did you hear about us?", "Are you willing to relocate?", "What is your preferred work arrangement?", "What is your gender?"]) assert.ok(sql.includes(`'${question}'`), question);
  assert.match(sql, /where not exists\(select 1 from public\.application_guide_entries e where e\.question=v\.question\)/, "re-running does not duplicate entries");
  assert.match(sql, /and e\.autofill_mode='NONE';/, "seeding never overwrites an Admin's rule");
});
