-- Isolated draft previews: never materialize a Resume or alter an Application.
create table public.tailoring_prompt_test_runs (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.tailoring_prompt_definitions(id),
  draft_revision integer not null,
  application_id uuid not null references public.applications(id),
  input jsonb not null,
  status text not null default 'PENDING' check(status in('PENDING','PROCESSING','COMPLETED','FAILED')),
  ticket_hash text not null unique,
  expires_at timestamptz not null default now()+interval '2 hours',
  result jsonb,
  failure_code text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.tailoring_prompt_test_runs enable row level security;
revoke all on public.tailoring_prompt_test_runs from public,anon,authenticated;
-- Read RPCs deliberately omit both input (resume data) and ticket hash.

create function public.read_tailoring_prompt_test_v113(p_test_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.tailoring_prompt_test_runs;
begin
  if not public.tailoring_prompt_manager_v1() then raise exception 'PROMPT_FORBIDDEN: An active manager or admin is required.' using errcode='42501'; end if;
  select * into r from public.tailoring_prompt_test_runs where id=p_test_id;
  if not found then raise exception 'PROMPT_TEST_NOT_FOUND: Test run not found.'; end if;
  return (to_jsonb(r)-'input'-'ticket_hash') || jsonb_build_object('status',case when r.expires_at<=now() and r.status in('PENDING','PROCESSING') then 'EXPIRED' else r.status end);
end;
$$;
create function public.create_tailoring_prompt_test_v113(p_prompt_id uuid,p_expected_revision integer,p_application_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare d public.tailoring_prompt_definitions; source jsonb; selection jsonb; run_id uuid;
  ticket text:='tpt_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
  if not public.tailoring_prompt_manager_v1() then raise exception 'PROMPT_FORBIDDEN: An active manager or admin is required.' using errcode='42501'; end if;
  select * into d from public.tailoring_prompt_definitions where id=p_prompt_id for share;
  if not found then raise exception 'PROMPT_NOT_FOUND: Prompt not found.'; end if;
  if d.revision is distinct from p_expected_revision then raise exception 'PROMPT_STALE: Reload the draft before testing.'; end if;
  source:=public.tailoring_source_input_v112(p_application_id);
  selection:=jsonb_build_object('promptId',d.id,'name',d.draft_name,'version',null,'instructions',d.draft_body,
    'scope',d.scope,'primaryCategoryId',d.primary_category_id,'subcategoryId',d.subcategory_id,
    'priority',d.draft_priority,'isTest',true,'draftRevision',d.revision);
  insert into public.tailoring_prompt_test_runs(prompt_id,draft_revision,application_id,input,ticket_hash,created_by)
    values(d.id,d.revision,p_application_id,public.compile_tailoring_prompt_v112(source,selection,now()),encode(digest(ticket,'sha256'),'hex'),auth.uid()) returning id into run_id;
  return jsonb_build_object('run',public.read_tailoring_prompt_test_v113(run_id),'ticket',ticket);
end;
$$;
create function public.run_tailoring_prompt_test_v113(p_ticket text,p_action text,p_result jsonb default null,p_failure_code text default null) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r public.tailoring_prompt_test_runs;
begin
  if coalesce(p_ticket,'')!~'^tpt_[0-9a-f]{64}$' then raise exception 'PROMPT_TEST_TICKET_INVALID: Invalid test ticket.'; end if;
  select * into r from public.tailoring_prompt_test_runs where ticket_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or r.expires_at<=now() then raise exception 'PROMPT_TEST_TICKET_EXPIRED: Create a new draft test command.'; end if;
  if not coalesce(public.is_active_user(r.created_by),false) or not coalesce(public.has_any_role(array['ADMIN','APPLYING_MANAGER'],r.created_by),false) then
    raise exception 'PROMPT_FORBIDDEN: The test creator no longer has manager access.' using errcode='42501';
  end if;
  if p_action='CLAIM' then
    if r.status not in('PENDING','PROCESSING') then raise exception 'PROMPT_CONFLICT: This test has already finished.'; end if;
    update public.tailoring_prompt_test_runs set status='PROCESSING' where id=r.id;
    return jsonb_build_object('testId',r.id,'input',r.input);
  elsif p_action='SUBMIT' then
    if jsonb_typeof(p_result) is distinct from 'object' then raise exception 'PROMPT_INVALID: A preview result is required.'; end if;
    if r.status='COMPLETED' and r.result=p_result then return jsonb_build_object('id',r.id,'status',r.status); end if;
    if r.status<>'PROCESSING' then raise exception 'PROMPT_CONFLICT: Claim an unfinished test before submitting.'; end if;
    perform public.assert_tailoring_preview_v14((r.input->'sourceResume'->>'id')::uuid,p_result);
    update public.tailoring_prompt_test_runs set result=p_result,status='COMPLETED',finished_at=now() where id=r.id;
    return jsonb_build_object('id',r.id,'status','COMPLETED');
  elsif p_action='FAIL' then
    if r.status<>'PROCESSING' then raise exception 'PROMPT_CONFLICT: Only a running test can fail.'; end if;
    if coalesce(p_failure_code,'')!~'^[A-Z_]{1,80}$' then raise exception 'PROMPT_INVALID: Invalid failure code.'; end if;
    update public.tailoring_prompt_test_runs set status='FAILED',failure_code=p_failure_code,finished_at=now() where id=r.id;
    return jsonb_build_object('id',r.id,'status','FAILED');
  end if;
  raise exception 'PROMPT_INVALID: Unsupported test action.';
end;
$$;
revoke all on function public.read_tailoring_prompt_test_v113(uuid),public.create_tailoring_prompt_test_v113(uuid,integer,uuid),
  public.run_tailoring_prompt_test_v113(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.read_tailoring_prompt_test_v113(uuid),public.create_tailoring_prompt_test_v113(uuid,integer,uuid) to authenticated;
grant execute on function public.run_tailoring_prompt_test_v113(text,text,jsonb,text) to anon;
