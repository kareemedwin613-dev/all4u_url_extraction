-- v3.164 AI-drafted answers for open-ended Autofill questions.
--
-- For questions no known answer fits and that ask for the candidate's own words ("Why do you want to work here?",
-- "Describe a project you are proud of"), the API asks the model the Admin chose to draft an answer from the
-- Application's Resume and the job description. Drafts are filled into the page and a person reviews them before
-- submitting. Drafts are not stored.
--
-- 1. get_autofill_draft_context_v3164: what the model may see for one Autofill session (the caller's own): the
--    Resume's summary, skills, work history, education and certifications, and the job's company, title and
--    description. Never the candidate's name, email, phone, address or links.
-- 2. Usage: drafted answers are counted per hour beside recognition, and drafting spend counts toward the cap.
-- 3. The Applier's wording lookup also returns the kind of a question without a standard answer, so the extension
--    can tell an open-ended question (draft it) from one that needs a standard answer (leave it for a person).

alter table public.autofill_ai_usage_hourly add column if not exists drafted_answers integer not null default 0 check (drafted_answers >= 0);

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
    -- The API checks the Admin's settings and the monthly cap before calling the model.
    'settings', public.autofill_ai_settings_json_v3161(),
    'monthCostMicroUsd', public.autofill_ai_month_cost_v3161())
  into v_result
  from public.application_extension_sessions s
  join public.applications a on a.id = s.application_id
  join public.job_descriptions j on j.id = a.job_description_id
  join public.resumes r on r.id = a.resume_id
  join public.resumes p on p.id = coalesce(r.parent_resume_id, r.id)
  where s.id = p_session_id and s.user_id = auth.uid() and s.action = 'AUTOFILL' and s.expires_at > now()
    and public.application_actor_can_view(a.assigned_to) and r.status = 'ACTIVE'
    -- The same consent that lets Autofill use the Resume's profile fields.
    and coalesce((p.autofill_preferences->>'allowProfileFields')::boolean, false);
  if v_result is null then raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found, or its Resume does not allow profile use.' using errcode = 'P0001'; end if;
  return v_result;
end;
$$;

-- The API's server key only: adds one drafting call's spend to this hour.
create or replace function public.record_autofill_ai_draft_usage_v3164(p_user_id uuid, p_session_id uuid, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = p_user_id and s.action = 'AUTOFILL') then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  insert into public.autofill_ai_usage_hourly(usage_hour, model_calls, drafted_answers, input_tokens, output_tokens, cost_micro_usd)
  values (date_trunc('hour', now()), 1, greatest(0, least(50, coalesce((p_usage->>'answers')::integer, 0))), greatest(0, coalesce((p_usage->>'inputTokens')::bigint, 0)),
    greatest(0, coalesce((p_usage->>'outputTokens')::bigint, 0)), greatest(0, coalesce((p_usage->>'costMicroUsd')::bigint, 0)))
  on conflict (usage_hour) do update set model_calls = autofill_ai_usage_hourly.model_calls + 1,
    drafted_answers = autofill_ai_usage_hourly.drafted_answers + excluded.drafted_answers,
    input_tokens = autofill_ai_usage_hourly.input_tokens + excluded.input_tokens, output_tokens = autofill_ai_usage_hourly.output_tokens + excluded.output_tokens,
    cost_micro_usd = autofill_ai_usage_hourly.cost_micro_usd + excluded.cost_micro_usd;
  return jsonb_build_object('recorded', true);
end;
$$;

-- Same as v3.161/v3.162, and each hit also carries answerKind.
create or replace function public.lookup_autofill_learned_wordings_v3161(p_session_id uuid, p_questions text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hits jsonb; v_ids uuid[]; v_hit_count integer;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode = '42501'; end if;
  if not exists(select 1 from public.application_extension_sessions s where s.id = p_session_id and s.user_id = auth.uid() and s.action = 'AUTOFILL' and s.expires_at > now()) then
    raise exception 'AUTOFILL_SESSION_NOT_FOUND: The Autofill session was not found.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_questions, 1), 0) > 50 then raise exception 'VALIDATION_ERROR: Send at most 50 questions.' using errcode = '22023'; end if;
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

-- Same as v3.161, and each hour also carries draftedAnswers.
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
        'questionsFromTable', u.questions_from_table, 'modelCalls', u.model_calls, 'questionsSent', u.questions_sent, 'draftedAnswers', u.drafted_answers,
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

revoke all on function public.get_autofill_draft_context_v3164(uuid) from public, anon;
revoke all on function public.record_autofill_ai_draft_usage_v3164(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_autofill_draft_context_v3164(uuid) to authenticated;
grant execute on function public.record_autofill_ai_draft_usage_v3164(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
