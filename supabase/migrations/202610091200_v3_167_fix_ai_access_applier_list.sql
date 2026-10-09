-- v3.167 The "AI access by applier" table listed nobody.
--
-- v3.165 chose people with has_role('APPLIER', p.id), but has_role() checks is_active_user(), which is true only
-- for the signed-in person, so every other Applier was left out. Roles are now read directly, and Applying Managers
-- and Admins are listed too, since they can also run Autofill.

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
      -- Roles are read directly: has_role() and is_active_user() only answer for the signed-in person.
      where (p.status = 'ACTIVE' and exists(select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = p.id and r.active and r.code in ('APPLIER', 'APPLYING_MANAGER', 'ADMIN')))
        or a.user_id is not null or u.pages is not null or u.model_calls is not null
    ) rows), '[]'::jsonb));
end;
$$;

notify pgrst, 'reload schema';
