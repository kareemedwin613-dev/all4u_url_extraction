-- v3.165 Per-person AI Autofill access and usage.
--
-- 1. Admins give each person AI access, one level at a time:
--      OFF   (no row; the default for everyone, including people added later)
--      MATCH AI matches new question wordings to standard answers
--      DRAFT also drafts answers to open-ended questions
--    The on/off switch in the AI settings still turns AI off for everyone. Learned wordings (a table lookup, no
--    model call, no cost) keep answering for everyone, as they do when AI is switched off.
-- 2. Usage is also counted per person per hour (counts and cost only, never questions or answers), for the
--    Overview's "By applier" table and the applier page.
-- 3. An Autofill session records when it first called the model, so "Autofill runs with AI" counts runs, not calls.

create table if not exists public.autofill_ai_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level text not null check (level in ('MATCH', 'DRAFT')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);
create table if not exists public.autofill_ai_access_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  level text not null check (level in ('OFF', 'MATCH', 'DRAFT')),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists autofill_ai_access_history_user_idx on public.autofill_ai_access_history(user_id, changed_at desc);

create table if not exists public.autofill_ai_usage_user_hourly (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_hour timestamptz not null check (usage_hour = date_trunc('hour', usage_hour)),
  pages integer not null default 0 check (pages >= 0),
  questions_asked integer not null default 0 check (questions_asked >= 0),
  questions_from_table integer not null default 0 check (questions_from_table >= 0),
  model_calls integer not null default 0 check (model_calls >= 0),
  questions_sent integer not null default 0 check (questions_sent >= 0),
  questions_matched integer not null default 0 check (questions_matched >= 0), -- new wordings the model matched to a standard answer
  drafted_answers integer not null default 0 check (drafted_answers >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  primary key (user_id, usage_hour)
);
create index if not exists autofill_ai_usage_user_hourly_hour_idx on public.autofill_ai_usage_user_hourly(usage_hour);

alter table public.application_extension_sessions add column if not exists ai_used_at timestamptz;
create index if not exists application_extension_sessions_ai_used_idx on public.application_extension_sessions(ai_used_at) where ai_used_at is not null;

alter table public.autofill_ai_access enable row level security;
alter table public.autofill_ai_access_history enable row level security;
alter table public.autofill_ai_usage_user_hourly enable row level security;
revoke all on table public.autofill_ai_access from public, anon, authenticated;
revoke all on table public.autofill_ai_access_history from public, anon, authenticated;
revoke all on table public.autofill_ai_usage_user_hourly from public, anon, authenticated;
comment on table public.autofill_ai_access is 'AI Autofill access per person, granted by Admins. No row means OFF.';

-- OFF, MATCH or DRAFT for one person.
create or replace function public.autofill_ai_level_v3165(p_user_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select a.level from public.autofill_ai_access a where a.user_id = p_user_id), 'OFF');
$$;

-- Adds counters to one person's current hour.
create or replace function public.autofill_ai_add_user_usage_v3165(p_user_id uuid, p_usage jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n jsonb := coalesce(p_usage, '{}'::jsonb);
begin
  insert into public.autofill_ai_usage_user_hourly(user_id, usage_hour, pages, questions_asked, questions_from_table, model_calls, questions_sent,
    questions_matched, drafted_answers, input_tokens, output_tokens, cost_micro_usd)
  values (p_user_id, date_trunc('hour', now()),
    greatest(0, coalesce((n->>'pages')::integer, 0)), greatest(0, coalesce((n->>'questionsAsked')::integer, 0)),
    greatest(0, coalesce((n->>'questionsFromTable')::integer, 0)), greatest(0, coalesce((n->>'modelCalls')::integer, 0)),
    greatest(0, coalesce((n->>'questionsSent')::integer, 0)), greatest(0, coalesce((n->>'questionsMatched')::integer, 0)),
    greatest(0, coalesce((n->>'draftedAnswers')::integer, 0)), greatest(0, coalesce((n->>'inputTokens')::bigint, 0)),
    greatest(0, coalesce((n->>'outputTokens')::bigint, 0)), greatest(0, coalesce((n->>'costMicroUsd')::bigint, 0)))
  on conflict (user_id, usage_hour) do update set
    pages = autofill_ai_usage_user_hourly.pages + excluded.pages,
    questions_asked = autofill_ai_usage_user_hourly.questions_asked + excluded.questions_asked,
    questions_from_table = autofill_ai_usage_user_hourly.questions_from_table + excluded.questions_from_table,
    model_calls = autofill_ai_usage_user_hourly.model_calls + excluded.model_calls,
    questions_sent = autofill_ai_usage_user_hourly.questions_sent + excluded.questions_sent,
    questions_matched = autofill_ai_usage_user_hourly.questions_matched + excluded.questions_matched,
    drafted_answers = autofill_ai_usage_user_hourly.drafted_answers + excluded.drafted_answers,
    input_tokens = autofill_ai_usage_user_hourly.input_tokens + excluded.input_tokens,
    output_tokens = autofill_ai_usage_user_hourly.output_tokens + excluded.output_tokens,
    cost_micro_usd = autofill_ai_usage_user_hourly.cost_micro_usd + excluded.cost_micro_usd;
end;
$$;

-- Same as v3.164, and: counts the page for the caller, and returns the caller's AI level.
create or replace function public.lookup_autofill_learned_wordings_v3161(p_session_id uuid, p_questions text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hits jsonb; v_ids uuid[]; v_hit_count integer; v_asked integer := coalesce(array_length(p_questions, 1), 0);
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501'; end if;
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = auth.uid() and s.action = 'AUTOFILL' and s.expires_at > now()) then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  if v_asked > 50 then raise exception 'VALIDATION_ERROR: Send at most 50 questions.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('index', q.ord - 1, 'targetKey', w.target_key, 'confidence', w.confidence, 'answerKind', w.answer_kind) order by q.ord), '[]'::jsonb),
         coalesce(array_agg(distinct w.id) filter (where w.last_used_on < current_date), '{}')
    into v_hits, v_ids
    from unnest(coalesce(p_questions, '{}')) with ordinality q(asked, ord)
    join public.autofill_learned_wordings w on w.normalized_question = public.autofill_learned_normalize_v3161(q.asked)
   where public.autofill_learned_target_ok_v3161(w.target_key);
  if array_length(v_ids, 1) > 0 then
    update public.autofill_learned_wordings set last_used_on = current_date, days_used = days_used + 1 where id = any(v_ids);
  end if;
  v_hit_count := jsonb_array_length(v_hits);
  insert into public.autofill_ai_usage_hourly(usage_hour, pages, questions_asked, questions_from_table)
  values (date_trunc('hour', now()), 1, v_asked, v_hit_count)
  on conflict (usage_hour) do update set pages = autofill_ai_usage_hourly.pages + 1,
    questions_asked = autofill_ai_usage_hourly.questions_asked + excluded.questions_asked,
    questions_from_table = autofill_ai_usage_hourly.questions_from_table + excluded.questions_from_table;
  perform public.autofill_ai_add_user_usage_v3165(auth.uid(), jsonb_build_object('pages', 1, 'questionsAsked', v_asked, 'questionsFromTable', v_hit_count));
  return jsonb_build_object(
    'hits', v_hits,
    'targets', coalesce((select jsonb_agg(jsonb_build_object('key', 'guide.' || g.id, 'question', g.question,
        'wordings', to_jsonb((g.autofill_patterns)[1:5])) order by g.sort_order, g.question)
      from public.application_guide_entries g where g.status = 'PUBLISHED' and g.autofill_mode <> 'NONE'), '[]'::jsonb),
    'monthCostMicroUsd', public.autofill_ai_month_cost_v3161(),
    'settings', public.autofill_ai_settings_json_v3161(),
    'aiLevel', public.autofill_ai_level_v3165(auth.uid()));
end;
$$;

-- Same as v3.161, and: counts the call (and how many new wordings were matched) for the Applier, and marks the
-- session as having used AI. Spend already incurred is always recorded, even if access changed meanwhile.
create or replace function public.save_autofill_learned_wordings_v3161(p_user_id uuid, p_session_id uuid, p_model text, p_items jsonb, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_question text; v_normalized text; v_target text; v_confidence integer; v_kind text; v_saved integer := 0; v_matched integer := 0;
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
    -- The kind matters only when no known answer fits.
    v_kind := case when v_target = 'none' and upper(coalesce(v_item->>'answerKind', '')) in ('SAME_FOR_EVERYONE', 'DEPENDS_ON_PROFILE', 'ESSAY', 'NOT_A_QUESTION')
      then upper(v_item->>'answerKind') end;
    continue when char_length(v_normalized) < 2 or char_length(v_question) < 2 or v_confidence < 80 or not public.autofill_learned_target_ok_v3161(v_target);
    insert into public.autofill_learned_wordings(normalized_question, question, target_key, confidence, model, answer_kind)
    values (v_normalized, v_question, v_target, v_confidence, v_model, v_kind)
    on conflict (normalized_question) do update set question = excluded.question, target_key = excluded.target_key,
      confidence = excluded.confidence, model = excluded.model, answer_kind = excluded.answer_kind, last_used_on = current_date;
    v_saved := v_saved + 1;
    if v_target <> 'none' then v_matched := v_matched + 1; end if;
  end loop;
  insert into public.autofill_ai_usage_hourly(usage_hour, model_calls, questions_sent, input_tokens, output_tokens, cost_micro_usd)
  values (date_trunc('hour', now()), 1, greatest(0, coalesce((p_usage->>'questions')::integer, 0)), greatest(0, coalesce((p_usage->>'inputTokens')::bigint, 0)),
    greatest(0, coalesce((p_usage->>'outputTokens')::bigint, 0)), greatest(0, coalesce((p_usage->>'costMicroUsd')::bigint, 0)))
  on conflict (usage_hour) do update set model_calls = autofill_ai_usage_hourly.model_calls + 1,
    questions_sent = autofill_ai_usage_hourly.questions_sent + excluded.questions_sent,
    input_tokens = autofill_ai_usage_hourly.input_tokens + excluded.input_tokens, output_tokens = autofill_ai_usage_hourly.output_tokens + excluded.output_tokens,
    cost_micro_usd = autofill_ai_usage_hourly.cost_micro_usd + excluded.cost_micro_usd;
  perform public.autofill_ai_add_user_usage_v3165(p_user_id, jsonb_build_object('modelCalls', 1, 'questionsSent', p_usage->'questions', 'questionsMatched', v_matched,
    'inputTokens', p_usage->'inputTokens', 'outputTokens', p_usage->'outputTokens', 'costMicroUsd', p_usage->'costMicroUsd'));
  update public.application_extension_sessions set ai_used_at = now() where id = p_session_id and ai_used_at is null;
  -- Wordings unused for six months are dropped a few at a time.
  delete from public.autofill_learned_wordings where id in (select id from public.autofill_learned_wordings where last_used_on < current_date - 180 limit 200);
  return jsonb_build_object('saved', v_saved);
end;
$$;

-- Same as v3.164, and: counts the drafting call for the Applier and marks the session as having used AI.
create or replace function public.record_autofill_ai_draft_usage_v3164(p_user_id uuid, p_session_id uuid, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_answers integer := greatest(0, least(50, coalesce((p_usage->>'answers')::integer, 0)));
begin
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = p_user_id and s.action = 'AUTOFILL') then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  insert into public.autofill_ai_usage_hourly(usage_hour, model_calls, drafted_answers, input_tokens, output_tokens, cost_micro_usd)
  values (date_trunc('hour', now()), 1, v_answers, greatest(0, coalesce((p_usage->>'inputTokens')::bigint, 0)),
    greatest(0, coalesce((p_usage->>'outputTokens')::bigint, 0)), greatest(0, coalesce((p_usage->>'costMicroUsd')::bigint, 0)))
  on conflict (usage_hour) do update set model_calls = autofill_ai_usage_hourly.model_calls + 1,
    drafted_answers = autofill_ai_usage_hourly.drafted_answers + excluded.drafted_answers,
    input_tokens = autofill_ai_usage_hourly.input_tokens + excluded.input_tokens, output_tokens = autofill_ai_usage_hourly.output_tokens + excluded.output_tokens,
    cost_micro_usd = autofill_ai_usage_hourly.cost_micro_usd + excluded.cost_micro_usd;
  perform public.autofill_ai_add_user_usage_v3165(p_user_id, jsonb_build_object('modelCalls', 1, 'draftedAnswers', v_answers,
    'inputTokens', p_usage->'inputTokens', 'outputTokens', p_usage->'outputTokens', 'costMicroUsd', p_usage->'costMicroUsd'));
  update public.application_extension_sessions set ai_used_at = now() where id = p_session_id and ai_used_at is null;
  return jsonb_build_object('recorded', true);
end;
$$;

-- Same as v3.164, and returns the caller's AI level (the API drafts only for DRAFT).
create or replace function public.get_autofill_draft_context_v3164(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'resume', jsonb_build_object(
      'summary', left(coalesce(nullif(btrim(r.structured_content->>'summary'), ''), p.structured_content->>'summary', ''), 3000),
      'skills', left(coalesce(nullif(btrim(r.structured_content->>'skills'), ''), p.structured_content->>'skills', ''), 3000),
      'experience', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'jobTitle', x.value->>'job_title', 'company', x.value->>'company', 'startDate', x.value->'start_date', 'endDate', x.value->'end_date',
          'isCurrent', lower(coalesce(x.value->>'is_current', 'false')) in ('true', 't', '1', 'yes'),
          'details', left(nullif(btrim(coalesce(x.value->>'experience_details', '')), ''), 2500))) order by x.ordinality)
        from jsonb_array_elements(case
          when jsonb_typeof(r.structured_content->'professional_experience') = 'array' and jsonb_array_length(r.structured_content->'professional_experience') > 0 then r.structured_content->'professional_experience'
          when jsonb_typeof(p.structured_content->'professional_experience') = 'array' then p.structured_content->'professional_experience'
          else '[]'::jsonb end) with ordinality x(value, ordinality) where x.ordinality <= 8), '[]'::jsonb),
      'education', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'institution', x.value->>'institution', 'degree', x.value->>'degree', 'fieldOfStudy', x.value->>'field_of_study', 'endDate', x.value->'end_date')) order by x.ordinality)
        from jsonb_array_elements(case
          when jsonb_typeof(r.structured_content->'education') = 'array' and jsonb_array_length(r.structured_content->'education') > 0 then r.structured_content->'education'
          when jsonb_typeof(p.structured_content->'education') = 'array' then p.structured_content->'education'
          else '[]'::jsonb end) with ordinality x(value, ordinality) where x.ordinality <= 6), '[]'::jsonb),
      'educationText', case when jsonb_typeof(p.structured_content->'education') = 'array' and jsonb_array_length(p.structured_content->'education') > 0 then ''
        else left(coalesce(p.structured_content->>'education_legacy_text', ''), 1500) end,
      'certifications', coalesce((select jsonb_agg(x.value->>'name') from jsonb_array_elements(case when jsonb_typeof(p.structured_content->'certifications') = 'array'
        then p.structured_content->'certifications' else '[]'::jsonb end) x where nullif(btrim(coalesce(x.value->>'name', '')), '') is not null), '[]'::jsonb)),
    'job', jsonb_build_object('company', j.company, 'title', j.job_title, 'description', left(coalesce(j.description_text, ''), 8000)),
    'settings', public.autofill_ai_settings_json_v3161(),
    'monthCostMicroUsd', public.autofill_ai_month_cost_v3161(),
    'aiLevel', public.autofill_ai_level_v3165(auth.uid()))
  into v_result
  from public.application_extension_sessions s
  join public.applications a on a.id = s.application_id
  join public.job_descriptions j on j.id = a.job_description_id
  join public.resumes r on r.id = a.resume_id
  join public.resumes p on p.id = coalesce(r.parent_resume_id, r.id)
  where s.id = p_session_id and s.user_id = auth.uid() and s.action = 'AUTOFILL' and s.expires_at > now()
    and public.application_actor_can_view(a.assigned_to) and r.status = 'ACTIVE'
    and coalesce((p.autofill_preferences->>'allowProfileFields')::boolean, false);
  if v_result is null then raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found, or its Resume does not allow profile use.' using errcode = 'P0001'; end if;
  return v_result;
end;
$$;

-- Admins: everyone who may use Autofill (Appliers, plus anyone with access or usage in the period), each with their
-- AI level and their usage in the period.
create or replace function public.autofill_ai_applier_report_v3165(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now() + interval '1 hour');
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('ADMIN', auth.uid())) then
    raise exception 'FORBIDDEN: Only an Admin can view AI access and usage.' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to - v_from > interval '400 days' then raise exception 'VALIDATION_ERROR: Choose a period of up to 400 days.' using errcode = '22023'; end if;
  return jsonb_build_object('appliers', coalesce((
    select jsonb_agg(row_json order by (row_json->>'costMicroUsd')::bigint desc, row_json->>'name')
    from (
      select jsonb_build_object(
        'userId', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email, 'active', p.status = 'ACTIVE',
        'level', coalesce(a.level, 'OFF'), 'grantedAt', a.granted_at,
        'grantedByName', (select nullif(btrim(g.full_name), '') from public.profiles g where g.id = a.granted_by),
        'autofillRuns', (select count(*) from public.application_extension_sessions s where s.user_id = p.id and s.action = 'AUTOFILL' and s.created_at >= v_from and s.created_at < v_to),
        'aiRuns', (select count(*) from public.application_extension_sessions s where s.user_id = p.id and s.ai_used_at >= v_from and s.ai_used_at < v_to),
        'pages', coalesce(u.pages, 0), 'questionsAsked', coalesce(u.questions_asked, 0), 'questionsFromTable', coalesce(u.questions_from_table, 0),
        'modelCalls', coalesce(u.model_calls, 0), 'questionsSent', coalesce(u.questions_sent, 0), 'questionsMatched', coalesce(u.questions_matched, 0),
        'draftedAnswers', coalesce(u.drafted_answers, 0), 'costMicroUsd', coalesce(u.cost_micro_usd, 0)) as row_json
      from public.profiles p
      left join public.autofill_ai_access a on a.user_id = p.id
      left join lateral (
        select sum(h.pages) pages, sum(h.questions_asked) questions_asked, sum(h.questions_from_table) questions_from_table, sum(h.model_calls) model_calls,
          sum(h.questions_sent) questions_sent, sum(h.questions_matched) questions_matched, sum(h.drafted_answers) drafted_answers, sum(h.cost_micro_usd) cost_micro_usd
        from public.autofill_ai_usage_user_hourly h
        where h.user_id = p.id and h.usage_hour >= date_trunc('hour', v_from) and h.usage_hour < v_to
      ) u on true
      where (p.status = 'ACTIVE' and public.has_role('APPLIER', p.id)) or a.user_id is not null or u.pages is not null or u.model_calls is not null
    ) rows), '[]'::jsonb));
end;
$$;

-- Admins set one person's level. OFF removes the access row; every change is kept in the history.
create or replace function public.set_autofill_ai_access_v3165(p_user_id uuid, p_level text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_level text := upper(btrim(coalesce(p_level, '')));
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('ADMIN', auth.uid())) then
    raise exception 'FORBIDDEN: Only an Admin can change AI access.' using errcode = '42501';
  end if;
  if v_level not in ('OFF', 'MATCH', 'DRAFT') then raise exception 'VALIDATION_ERROR: Choose Off, Match questions or Match and draft.' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles p where p.id = p_user_id) then raise exception 'USER_NOT_FOUND: That person was not found.' using errcode = 'P0002'; end if;
  if v_level = 'OFF' then
    delete from public.autofill_ai_access where user_id = p_user_id;
  else
    insert into public.autofill_ai_access(user_id, level, granted_by, granted_at) values (p_user_id, v_level, auth.uid(), now())
    on conflict (user_id) do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = excluded.granted_at;
  end if;
  insert into public.autofill_ai_access_history(user_id, level, changed_by) values (p_user_id, v_level, auth.uid());
  return jsonb_build_object('userId', p_user_id, 'level', v_level);
end;
$$;

revoke all on function public.autofill_ai_level_v3165(uuid) from public, anon, authenticated;
revoke all on function public.autofill_ai_add_user_usage_v3165(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.autofill_ai_applier_report_v3165(timestamptz, timestamptz) from public, anon;
revoke all on function public.set_autofill_ai_access_v3165(uuid, text) from public, anon;
grant execute on function public.autofill_ai_applier_report_v3165(timestamptz, timestamptz) to authenticated;
grant execute on function public.set_autofill_ai_access_v3165(uuid, text) to authenticated;

notify pgrst, 'reload schema';
