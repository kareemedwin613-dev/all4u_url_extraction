-- v3.166 Admins correct what AI learned, and contact fields become targets.
--
-- 1. A learned wording can point at a contact field ("field.linkedInUrl"), so a box such as
--    "LinkedIn Profile: Please provide the URL to your professional profile" is filled from the Resume's LinkedIn
--    URL. The AI may choose these targets too.
-- 2. Admins correct a learned wording on the Application Guide page: a standard answer, a Resume answer, a contact
--    field, or "no standard answer" with the kind of question. A corrected wording is never overwritten by the AI.

alter table public.autofill_learned_wordings drop constraint if exists autofill_learned_wordings_target_key_check;
alter table public.autofill_learned_wordings add constraint autofill_learned_wordings_target_key_check
  check (target_key ~ '^(guide\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|answer\.[a-z_]{2,40}|field\.[A-Za-z0-9]{2,40}|none)$');
alter table public.autofill_learned_wordings
  add column if not exists corrected_by uuid references public.profiles(id) on delete set null,
  add column if not exists corrected_at timestamptz;

-- Same as v3.161, and contact fields the extension can fill from the Resume.
create or replace function public.autofill_learned_target_ok_v3161(p_target text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_target = 'none' then true
    when p_target ~ '^answer\.' then substr(p_target, 8) in ('authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date',
      'desired_salary','years_of_experience','remote_work_preference','gender_identity','race_ethnicity','veteran_status')
    when p_target ~ '^field\.' then substr(p_target, 7) in ('firstName','middleName','lastName','fullName','email','phone','addressLine1','city','state',
      'postalCode','country','currentLocation','linkedInUrl','githubUrl','portfolioUrl','currentCompany')
    when p_target ~ '^guide\.[0-9a-f-]{36}$' then exists(select 1 from public.application_guide_entries g
      where g.id = substr(p_target, 7)::uuid and g.status = 'PUBLISHED' and g.autofill_mode <> 'NONE')
    else false end;
$$;

-- Same as v3.165, and a wording an Admin corrected keeps the correction.
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
      confidence = excluded.confidence, model = excluded.model, answer_kind = excluded.answer_kind, last_used_on = current_date
      where autofill_learned_wordings.corrected_at is null;
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

-- Same as v3.162, and who corrected each wording.
create or replace function public.list_autofill_learned_wordings_v3161(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can review learned Autofill wordings.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'question', w.question, 'targetKey', w.target_key,
        'targetQuestion', case when w.target_key ~ '^guide\.' then (select g.question from public.application_guide_entries g where g.id = substr(w.target_key, 7)::uuid) end,
        'answerKind', w.answer_kind, 'confidence', w.confidence, 'model', w.model, 'daysUsed', w.days_used, 'createdAt', w.created_at, 'lastUsedOn', w.last_used_on,
        'correctedAt', w.corrected_at, 'correctedByName', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = w.corrected_by)) order by w.created_at desc)
      from (select * from public.autofill_learned_wordings order by created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) w), '[]'::jsonb),
    'total', (select count(*) from public.autofill_learned_wordings),
    'needsStandardAnswer', (select count(*) from public.autofill_learned_wordings where target_key = 'none' and answer_kind = 'SAME_FOR_EVERYONE'),
    'month', (select jsonb_build_object('requests', coalesce(sum(u.model_calls), 0), 'questions', coalesce(sum(u.questions_sent), 0), 'costMicroUsd', coalesce(sum(u.cost_micro_usd), 0))
      from public.autofill_ai_usage_hourly u where u.usage_hour >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'));
end;
$$;

-- Admins: what a learned wording really asks for. Applies from the next Autofill page for everyone.
create or replace function public.correct_autofill_learned_wording_v3166(p_id uuid, p_target_key text, p_answer_kind text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target text := btrim(coalesce(p_target_key, '')); v_kind text := nullif(upper(btrim(coalesce(p_answer_kind, ''))), '');
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can correct learned Autofill wordings.' using errcode = '42501'; end if;
  if not public.autofill_learned_target_ok_v3161(v_target) then
    raise exception 'VALIDATION_ERROR: Choose a published standard answer, a Resume answer, a contact field, or no standard answer.' using errcode = '22023';
  end if;
  if v_target <> 'none' then v_kind := null;
  elsif v_kind is null or v_kind not in ('SAME_FOR_EVERYONE', 'DEPENDS_ON_PROFILE', 'ESSAY', 'NOT_A_QUESTION') then
    raise exception 'VALIDATION_ERROR: Choose what kind of question it is.' using errcode = '22023';
  end if;
  update public.autofill_learned_wordings set target_key = v_target, answer_kind = v_kind, confidence = 100, corrected_by = auth.uid(), corrected_at = now()
   where id = p_id;
  if not found then raise exception 'LEARNED_WORDING_NOT_FOUND: That wording was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', p_id, 'targetKey', v_target, 'answerKind', v_kind);
end;
$$;

revoke all on function public.correct_autofill_learned_wording_v3166(uuid, text, text) from public, anon;
grant execute on function public.correct_autofill_learned_wording_v3166(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
