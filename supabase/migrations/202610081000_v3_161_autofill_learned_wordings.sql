-- v3.161 AI-recognized Autofill question wordings.
--
-- When Autofill meets a question its rules cannot answer, the API asks a model which known answer the question
-- is asking for (an Application Guide entry, a Resume answer, or none). The result is stored here by its
-- normalized wording and reused for every Applier, so each wording costs one model call.
--
-- Stored: scrubbed employer wording (no emails, links, or long digit runs) and the answer it maps to.
-- Never stored: answers, candidate values, Resume or JD content.
-- Writes come only from the API's server key, so an Applier cannot write mappings directly.

create table if not exists public.autofill_learned_wordings (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique check (char_length(normalized_question) between 2 and 300),
  question text not null check (char_length(question) between 2 and 300),
  -- guide.<entry id>, answer.<Resume answer key>, or none (no known answer fits; do not ask again).
  target_key text not null check (target_key ~ '^(guide\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|answer\.[a-z_]{2,40}|none)$'),
  confidence smallint not null check (confidence between 0 and 100),
  model text not null check (char_length(model) between 1 and 80),
  days_used integer not null default 0 check (days_used >= 0),
  created_at timestamptz not null default now(),
  -- Updated at most once a day per wording, so frequent wordings do not cause a write on every page.
  last_used_on date not null default current_date
);
create index if not exists autofill_learned_wordings_last_used_idx on public.autofill_learned_wordings(last_used_on);

-- Usage per hour: hourly buckets let the Overview group by the viewer's own local days, and they feed the
-- monthly cap. At most 24 small rows a day.
create table if not exists public.autofill_ai_usage_hourly (
  usage_hour timestamptz primary key check (usage_hour = date_trunc('hour', usage_hour)),
  pages integer not null default 0 check (pages >= 0),                               -- pages that had unanswered questions
  questions_asked integer not null default 0 check (questions_asked >= 0),           -- unanswered questions sent for recognition
  questions_from_table integer not null default 0 check (questions_from_table >= 0), -- answered from learned wordings, no model cost
  model_calls integer not null default 0 check (model_calls >= 0),
  questions_sent integer not null default 0 check (questions_sent >= 0),             -- new wordings sent to the model
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0)
);

alter table public.autofill_learned_wordings enable row level security;
alter table public.autofill_ai_usage_hourly enable row level security;
revoke all on table public.autofill_learned_wordings from public, anon, authenticated;
revoke all on table public.autofill_ai_usage_hourly from public, anon, authenticated;
comment on table public.autofill_learned_wordings is 'AI-recognized employer question wording mapped to a known Autofill answer. Never stores answers or candidate values.';
comment on table public.autofill_ai_usage_hourly is 'Hourly usage and model spend for Autofill question recognition. Counts only.';

-- Admin-editable settings (one row): on/off, provider, models, monthly cap. API keys are never stored here;
-- they stay in the API's environment. Without a row the API uses its environment defaults.
create table if not exists public.autofill_ai_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  provider text not null check (provider in ('openai', 'xai')),
  recognition_model text not null check (recognition_model ~ '^[a-z0-9][a-z0-9.-]{1,60}$'),
  drafting_model text not null check (drafting_model ~ '^[a-z0-9][a-z0-9.-]{1,60}$'),
  monthly_cap_usd numeric(10, 2) not null check (monthly_cap_usd between 0 and 10000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.autofill_ai_settings_history (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  settings jsonb not null
);
alter table public.autofill_ai_settings enable row level security;
alter table public.autofill_ai_settings_history enable row level security;
revoke all on table public.autofill_ai_settings from public, anon, authenticated;
revoke all on table public.autofill_ai_settings_history from public, anon, authenticated;
comment on table public.autofill_ai_settings is 'Autofill AI on/off, provider, models and monthly cap, edited by Admins. Never holds API keys.';

create or replace function public.autofill_ai_settings_json_v3161()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('enabled', s.enabled, 'provider', s.provider, 'recognitionModel', s.recognition_model, 'draftingModel', s.drafting_model,
    'monthlyCapUsd', s.monthly_cap_usd, 'updatedAt', s.updated_at, 'updatedByName', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = s.updated_by))
  from public.autofill_ai_settings s where s.id;
$$;

-- Spend in the current calendar month (UTC), which the monthly cap is measured against.
create or replace function public.autofill_ai_month_cost_v3161()
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(cost_micro_usd), 0)::bigint from public.autofill_ai_usage_hourly
   where usage_hour >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- Scrub, lowercase, drop dots and apostrophes ("U.S." = "US", "don't" = "dont"), other punctuation to spaces.
create or replace function public.autofill_learned_normalize_v3161(p_text text)
returns text language sql immutable security invoker set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(lower(public.autofill_question_scrub_v3157(p_text)), '[.''’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')), 300);
$$;

-- A target is usable while its Guide entry is published with an Autofill rule; Resume answer keys are fixed.
create or replace function public.autofill_learned_target_ok_v3161(p_target text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_target = 'none' then true
    when p_target ~ '^answer\.' then substr(p_target, 8) in ('authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date',
      'desired_salary','years_of_experience','remote_work_preference','gender_identity','race_ethnicity','veteran_status')
    when p_target ~ '^guide\.[0-9a-f-]{36}$' then exists(select 1 from public.application_guide_entries g
      where g.id = substr(p_target, 7)::uuid and g.status = 'PUBLISHED' and g.autofill_mode <> 'NONE')
    else false end;
$$;

-- The Applier's API call: which of this page's wordings are already known, what the model may choose from
-- for the rest, and this month's spend so far. Checks that the Autofill session is the caller's own.
create or replace function public.lookup_autofill_learned_wordings_v3161(p_session_id uuid, p_questions text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hits jsonb; v_ids uuid[]; v_hit_count integer;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501'; end if;
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = auth.uid() and s.action = 'AUTOFILL' and s.expires_at > now()) then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_questions, 1), 0) > 50 then raise exception 'VALIDATION_ERROR: Send at most 50 questions.' using errcode = '22023'; end if;
  -- Each hit carries its position in p_questions (0-based), so callers never re-implement the normalization.
  select coalesce(jsonb_agg(jsonb_build_object('index', q.ord - 1, 'targetKey', w.target_key, 'confidence', w.confidence) order by q.ord), '[]'::jsonb),
         coalesce(array_agg(distinct w.id) filter (where w.last_used_on < current_date), '{}')
    into v_hits, v_ids
    from unnest(coalesce(p_questions, '{}')) with ordinality q(asked, ord)
    join public.autofill_learned_wordings w on w.normalized_question = public.autofill_learned_normalize_v3161(q.asked)
   where public.autofill_learned_target_ok_v3161(w.target_key);
  if array_length(v_ids, 1) > 0 then
    update public.autofill_learned_wordings set last_used_on = current_date, days_used = days_used + 1 where id = any(v_ids);
  end if;
  v_hit_count := jsonb_array_length(v_hits);
  -- One counter update per page.
  insert into public.autofill_ai_usage_hourly(usage_hour, pages, questions_asked, questions_from_table)
  values (date_trunc('hour', now()), 1, coalesce(array_length(p_questions, 1), 0), v_hit_count)
  on conflict (usage_hour) do update set pages = autofill_ai_usage_hourly.pages + 1,
    questions_asked = autofill_ai_usage_hourly.questions_asked + excluded.questions_asked,
    questions_from_table = autofill_ai_usage_hourly.questions_from_table + excluded.questions_from_table;
  return jsonb_build_object(
    'hits', v_hits,
    'targets', coalesce((select jsonb_agg(jsonb_build_object('key', 'guide.' || g.id, 'question', g.question,
        'wordings', to_jsonb((g.autofill_patterns)[1:5])) order by g.sort_order, g.question)
      from public.application_guide_entries g where g.status = 'PUBLISHED' and g.autofill_mode <> 'NONE'), '[]'::jsonb),
    'monthCostMicroUsd', public.autofill_ai_month_cost_v3161(),
    'settings', public.autofill_ai_settings_json_v3161());
end;
$$;

-- The API's server key only: saves the model's confident results and adds this call's spend to the month.
-- p_user_id is the Applier the API authenticated; the session must be theirs.
create or replace function public.save_autofill_learned_wordings_v3161(p_user_id uuid, p_session_id uuid, p_model text, p_items jsonb, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_question text; v_normalized text; v_target text; v_confidence integer; v_saved integer := 0;
  v_model text := left(btrim(coalesce(p_model, '')), 80);
begin
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = p_user_id and s.action = 'AUTOFILL') then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 50 then
    raise exception 'VALIDATION_ERROR: Send at most 50 results.' using errcode = '22023';
  end if;
  if char_length(v_model) < 1 then raise exception 'VALIDATION_ERROR: The model is required.' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_question := public.autofill_question_scrub_v3157(v_item->>'question');
    v_normalized := public.autofill_learned_normalize_v3161(v_item->>'question');
    v_target := coalesce(v_item->>'targetKey', '');
    v_confidence := least(100, greatest(0, coalesce((v_item->>'confidence')::integer, 0)));
    continue when char_length(v_normalized) < 2 or char_length(v_question) < 2 or v_confidence < 80 or not public.autofill_learned_target_ok_v3161(v_target);
    insert into public.autofill_learned_wordings(normalized_question, question, target_key, confidence, model)
    values (v_normalized, v_question, v_target, v_confidence, v_model)
    on conflict (normalized_question) do update set question = excluded.question, target_key = excluded.target_key,
      confidence = excluded.confidence, model = excluded.model, last_used_on = current_date;
    v_saved := v_saved + 1;
  end loop;
  insert into public.autofill_ai_usage_hourly(usage_hour, model_calls, questions_sent, input_tokens, output_tokens, cost_micro_usd)
  values (date_trunc('hour', now()), 1, greatest(0, coalesce((p_usage->>'questions')::integer, 0)), greatest(0, coalesce((p_usage->>'inputTokens')::bigint, 0)),
    greatest(0, coalesce((p_usage->>'outputTokens')::bigint, 0)), greatest(0, coalesce((p_usage->>'costMicroUsd')::bigint, 0)))
  on conflict (usage_hour) do update set model_calls = autofill_ai_usage_hourly.model_calls + 1,
    questions_sent = autofill_ai_usage_hourly.questions_sent + excluded.questions_sent,
    input_tokens = autofill_ai_usage_hourly.input_tokens + excluded.input_tokens, output_tokens = autofill_ai_usage_hourly.output_tokens + excluded.output_tokens,
    cost_micro_usd = autofill_ai_usage_hourly.cost_micro_usd + excluded.cost_micro_usd;
  -- Wordings unused for six months are dropped a few at a time.
  delete from public.autofill_learned_wordings where id in (select id from public.autofill_learned_wordings where last_used_on < current_date - 180 limit 200);
  return jsonb_build_object('saved', v_saved);
end;
$$;

-- Admin review on the Application Guide page: what was learned, and this month's spend.
create or replace function public.list_autofill_learned_wordings_v3161(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can review learned Autofill wordings.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'question', w.question, 'targetKey', w.target_key,
        'targetQuestion', case when w.target_key ~ '^guide\.' then (select g.question from public.application_guide_entries g where g.id = substr(w.target_key, 7)::uuid) end,
        'confidence', w.confidence, 'model', w.model, 'daysUsed', w.days_used, 'createdAt', w.created_at, 'lastUsedOn', w.last_used_on) order by w.created_at desc)
      from (select * from public.autofill_learned_wordings order by created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) w), '[]'::jsonb),
    'total', (select count(*) from public.autofill_learned_wordings),
    'month', (select jsonb_build_object('requests', coalesce(sum(u.model_calls), 0), 'questions', coalesce(sum(u.questions_sent), 0), 'costMicroUsd', coalesce(sum(u.cost_micro_usd), 0))
      from public.autofill_ai_usage_hourly u where u.usage_hour >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'));
end;
$$;

-- Overview "AI Autofill Usage & Cost" card (Admins): hourly usage in the period (grouped into local days by the
-- dashboard), the month's spend for the cap, and how many Applications used Autofill in the period.
create or replace function public.autofill_ai_usage_report_v3161(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now() + interval '1 hour');
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('ADMIN', auth.uid())) then
    raise exception 'FORBIDDEN: Only an Admin can view AI usage and cost.' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to - v_from > interval '400 days' then raise exception 'VALIDATION_ERROR: Choose a period of up to 400 days.' using errcode = '22023'; end if;
  return jsonb_build_object(
    'hours', coalesce((select jsonb_agg(jsonb_build_object('hour', u.usage_hour, 'pages', u.pages, 'questionsAsked', u.questions_asked,
        'questionsFromTable', u.questions_from_table, 'modelCalls', u.model_calls, 'questionsSent', u.questions_sent,
        'inputTokens', u.input_tokens, 'outputTokens', u.output_tokens, 'costMicroUsd', u.cost_micro_usd) order by u.usage_hour)
      from public.autofill_ai_usage_hourly u where u.usage_hour >= date_trunc('hour', v_from) and u.usage_hour < v_to), '[]'::jsonb),
    'autofilledApplications', (select count(distinct s.application_id) from public.application_extension_sessions s
      where s.action = 'AUTOFILL' and s.created_at >= v_from and s.created_at < v_to),
    'month', jsonb_build_object('costMicroUsd', public.autofill_ai_month_cost_v3161(),
      'start', date_trunc('month', now() at time zone 'utc') at time zone 'utc',
      'end', (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'),
    'learnedWordings', (select count(*) from public.autofill_learned_wordings));
end;
$$;

-- Admins read the settings with the last 20 changes, and save them. Provider and model names are checked
-- against the API's model list before this is called; the database checks their shape and records history.
create or replace function public.get_autofill_ai_settings_v3161()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('ADMIN', auth.uid())) then
    raise exception 'FORBIDDEN: Only an Admin can view AI settings.' using errcode = '42501';
  end if;
  return jsonb_build_object('settings', public.autofill_ai_settings_json_v3161(),
    'history', coalesce((select jsonb_agg(jsonb_build_object('changedAt', h.changed_at, 'changedByName', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = h.changed_by),
        'settings', h.settings) order by h.changed_at desc)
      from (select * from public.autofill_ai_settings_history order by changed_at desc limit 20) h), '[]'::jsonb));
end;
$$;

create or replace function public.save_autofill_ai_settings_v3161(p_enabled boolean, p_provider text, p_recognition_model text, p_drafting_model text, p_monthly_cap_usd numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('ADMIN', auth.uid())) then
    raise exception 'FORBIDDEN: Only an Admin can change AI settings.' using errcode = '42501';
  end if;
  if p_provider not in ('openai', 'xai') then raise exception 'VALIDATION_ERROR: Choose OpenAI or Grok.' using errcode = '22023'; end if;
  if p_monthly_cap_usd is null or p_monthly_cap_usd < 0 or p_monthly_cap_usd > 10000 then raise exception 'VALIDATION_ERROR: The monthly cap must be between $0 and $10,000.' using errcode = '22023'; end if;
  insert into public.autofill_ai_settings(id, enabled, provider, recognition_model, drafting_model, monthly_cap_usd, updated_by, updated_at)
  values (true, coalesce(p_enabled, false), p_provider, p_recognition_model, p_drafting_model, round(p_monthly_cap_usd, 2), auth.uid(), now())
  on conflict (id) do update set enabled = excluded.enabled, provider = excluded.provider, recognition_model = excluded.recognition_model,
    drafting_model = excluded.drafting_model, monthly_cap_usd = excluded.monthly_cap_usd, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.autofill_ai_settings_history(changed_by, settings)
  values (auth.uid(), jsonb_build_object('enabled', coalesce(p_enabled, false), 'provider', p_provider, 'recognitionModel', p_recognition_model,
    'draftingModel', p_drafting_model, 'monthlyCapUsd', round(p_monthly_cap_usd, 2)));
  return public.autofill_ai_settings_json_v3161();
end;
$$;

create or replace function public.delete_autofill_learned_wording_v3161(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can remove learned Autofill wordings.' using errcode = '42501'; end if;
  delete from public.autofill_learned_wordings where id = p_id;
  if not found then raise exception 'LEARNED_WORDING_NOT_FOUND: That wording was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', p_id);
end;
$$;

revoke all on function public.autofill_learned_normalize_v3161(text) from public, anon, authenticated;
revoke all on function public.autofill_learned_target_ok_v3161(text) from public, anon, authenticated;
revoke all on function public.lookup_autofill_learned_wordings_v3161(uuid, text[]) from public, anon;
revoke all on function public.save_autofill_learned_wordings_v3161(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.list_autofill_learned_wordings_v3161(integer) from public, anon;
revoke all on function public.autofill_ai_month_cost_v3161() from public, anon, authenticated;
revoke all on function public.autofill_ai_settings_json_v3161() from public, anon, authenticated;
revoke all on function public.get_autofill_ai_settings_v3161() from public, anon;
revoke all on function public.save_autofill_ai_settings_v3161(boolean, text, text, text, numeric) from public, anon;
revoke all on function public.autofill_ai_usage_report_v3161(timestamptz, timestamptz) from public, anon;
revoke all on function public.delete_autofill_learned_wording_v3161(uuid) from public, anon;
grant execute on function public.lookup_autofill_learned_wordings_v3161(uuid, text[]) to authenticated;
grant execute on function public.save_autofill_learned_wordings_v3161(uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.list_autofill_learned_wordings_v3161(integer) to authenticated;
grant execute on function public.autofill_ai_usage_report_v3161(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_autofill_ai_settings_v3161() to authenticated;
grant execute on function public.save_autofill_ai_settings_v3161(boolean, text, text, text, numeric) to authenticated;
grant execute on function public.delete_autofill_learned_wording_v3161(uuid) to authenticated;
