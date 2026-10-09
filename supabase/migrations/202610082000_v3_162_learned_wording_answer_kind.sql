-- v3.162 What kind of answer a question without a standard answer needs.
--
-- When AI recognition finds no known answer for a question, it also says what kind of question it is:
--   SAME_FOR_EVERYONE   every candidate answers the same way (work arrangement, travel, contract roles):
--                       an Admin can add a standard answer for it on the Application Guide page
--   DEPENDS_ON_PROFILE  the answer comes from the candidate's own background (years with a skill, a licence)
--   ESSAY               open-ended (why this company, describe a project): for AI drafting
--   NOT_A_QUESTION      a statement, consent, attestation or heading: left for a person
-- Only the kind is stored, never an answer. Functions keep their v3.161 names and signatures.

alter table public.autofill_learned_wordings
  add column if not exists answer_kind text
  check (answer_kind is null or answer_kind in ('SAME_FOR_EVERYONE', 'DEPENDS_ON_PROFILE', 'ESSAY', 'NOT_A_QUESTION'));

create or replace function public.save_autofill_learned_wordings_v3161(p_user_id uuid, p_session_id uuid, p_model text, p_items jsonb, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_question text; v_normalized text; v_target text; v_confidence integer; v_kind text; v_saved integer := 0;
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

create or replace function public.list_autofill_learned_wordings_v3161(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.application_guide_admin() then raise exception 'FORBIDDEN: Only an Admin can review learned Autofill wordings.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'question', w.question, 'targetKey', w.target_key,
        'targetQuestion', case when w.target_key ~ '^guide\.' then (select g.question from public.application_guide_entries g where g.id = substr(w.target_key, 7)::uuid) end,
        'answerKind', w.answer_kind, 'confidence', w.confidence, 'model', w.model, 'daysUsed', w.days_used, 'createdAt', w.created_at, 'lastUsedOn', w.last_used_on) order by w.created_at desc)
      from (select * from public.autofill_learned_wordings order by created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) w), '[]'::jsonb),
    'total', (select count(*) from public.autofill_learned_wordings),
    'needsStandardAnswer', (select count(*) from public.autofill_learned_wordings where target_key = 'none' and answer_kind = 'SAME_FOR_EVERYONE'),
    'month', (select jsonb_build_object('requests', coalesce(sum(u.model_calls), 0), 'questions', coalesce(sum(u.questions_sent), 0), 'costMicroUsd', coalesce(sum(u.cost_micro_usd), 0))
      from public.autofill_ai_usage_hourly u where u.usage_hour >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'));
end;
$$;

notify pgrst, 'reload schema';
