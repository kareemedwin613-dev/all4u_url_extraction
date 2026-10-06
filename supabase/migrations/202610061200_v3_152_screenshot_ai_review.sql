-- Pre-submission screenshot QA. Reuses the existing application feedback columns.
-- No application workflow/Applied status is changed. Queue and audit are separate.
create table public.screenshot_review_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled boolean not null default false,
  model text not null,
  prompt_version text not null default 'screenshot-review-v1',
  guide_snapshot jsonb not null,
  assumptions jsonb not null default '{"gpa":"FORMAT_ONLY","citizenship":"US_CITIZEN"}'
);
create table public.screenshot_review_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.screenshot_review_batches(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  status text not null default 'PENDING' check(status in('PENDING','RUNNING','CORRECT','HAS_MISTAKES','CANNOT_VERIFY','FAILED','SKIPPED')),
  attempt_count integer not null default 0,
  lease_token uuid, lease_expires_at timestamptz,
  source_snapshot jsonb, result jsonb,
  diagnostic text not null default '',
  started_at timestamptz, finished_at timestamptz,
  unique(batch_id,application_id)
);
create index screenshot_review_queue on public.screenshot_review_items(batch_id,status);
create index screenshot_review_application on public.screenshot_review_items(application_id);
create table public.screenshot_review_tickets (
  token_hash text primary key,
  batch_id uuid not null references public.screenshot_review_batches(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now()+interval '24 hours'
);
create table public.screenshot_review_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.screenshot_review_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  attempt integer not null,
  status text not null,
  diagnostic text not null,
  result jsonb,
  source_snapshot jsonb,
  previous_feedback jsonb,
  initiated_by uuid not null references public.profiles(id)
);
alter table public.screenshot_review_batches enable row level security;
alter table public.screenshot_review_items enable row level security;
alter table public.screenshot_review_tickets enable row level security;
alter table public.screenshot_review_events enable row level security;
revoke all on public.screenshot_review_batches,public.screenshot_review_items,public.screenshot_review_tickets,public.screenshot_review_events from anon,authenticated;

-- Includes only explicit metadata, not identity inferred from generated resume prose.
create function public.screenshot_review_source(p_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'applicationId',a.id,'applicationUpdatedAt',a.updated_at,'resumeId',a.resume_id,
    'reviewStatus',a.screenshot_review_status,'feedbackAt',a.screenshot_feedback_at,
    'profileUpdatedAt',r.updated_at,'profileId',r.id,
    'candidate',jsonb_strip_nulls(jsonb_build_object(
      'fullName',r.candidate_name,'firstName',r.candidate_first_name,'middleName',r.candidate_middle_name,'lastName',r.candidate_last_name,
      'email',r.candidate_email,'phone',r.candidate_phone,'addressLine1',r.address_line_1,'addressLine2',r.address_line_2,
      'city',r.address_city,'state',r.address_state_region,'postalCode',r.address_postal_code,'country',r.address_country,
      'linkedin',r.linkedin_url,'github',r.github_url,'portfolio',r.portfolio_url)),
    'education',r.structured_content->'education',
    'employment',coalesce((select jsonb_agg(jsonb_build_object('company',e->>'company','jobTitle',e->>'job_title','location',e->>'location','startDate',e->'start_date','endDate',e->'end_date','isCurrent',e->'is_current'))
      from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) e),'[]'),
    'answers',coalesce((select jsonb_agg(jsonb_build_object('key',x.answer_key,'questions',x.question_patterns,'value',x.answer_value,'updatedAt',x.updated_at) order by x.answer_key)
      from public.resume_application_answers x where x.resume_id=r.id and x.active and x.review_status='VERIFIED'),'[]'),
    'job',jsonb_build_object('company',j.company,'title',j.job_title,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryCurrency',j.salary_currency,'salaryPeriod',j.salary_period),
    'screenshots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'path',s.storage_path,'mimeType',s.mime_type,'bytes',s.file_size_bytes,'createdAt',s.created_at) order by s.id)
      from public.application_screenshots s where s.application_id=a.id),'[]'))
  from public.applications a join public.resumes selected on selected.id=a.resume_id
  join public.resumes r on r.id=coalesce(selected.parent_resume_id,selected.id)
  join public.job_descriptions j on j.id=a.job_description_id where a.id=p_id
$$;
revoke all on function public.screenshot_review_source(uuid) from public,anon,authenticated;

create function public.screenshot_review_manage(p_operation text,p_body jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare b public.screenshot_review_batches; ids uuid[]; token text; guide jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) or not public.application_actor_can_manage() then
    raise exception 'SCREENSHOT_REVIEW_FORBIDDEN: An active Admin or Applying Manager is required.' using errcode='42501';
  end if;
  if p_operation='create' then
    select array_agg(distinct x::uuid) into ids from jsonb_array_elements_text(p_body->'applicationIds') x;
    if coalesce(cardinality(ids),0) not between 1 and 1000 then raise exception 'SCREENSHOT_REVIEW_INVALID: Select 1 to 1000 applications.'; end if;
    if coalesce(p_body->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$' then raise exception 'SCREENSHOT_REVIEW_INVALID: A vision-capable Codex model is required.'; end if;
    if exists(select 1 from unnest(ids) x where not exists(select 1 from public.applications where id=x)) then raise exception 'SCREENSHOT_REVIEW_NOT_FOUND: An application no longer exists.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'meaning',meaning,'howToAnswer',how_to_answer,'exampleAnswer',example_answer,'version',version) order by sort_order,id),'[]') into guide
      from public.application_guide_entries where status='PUBLISHED';
    if jsonb_array_length(guide)=0 then raise exception 'SCREENSHOT_REVIEW_NO_GUIDE: Publish the Application Guide first.'; end if;
    insert into public.screenshot_review_batches(created_by,model,guide_snapshot) values(auth.uid(),p_body->>'model',guide) returning * into b;
    insert into public.screenshot_review_items(batch_id,application_id,status,diagnostic,finished_at)
      select b.id,a.id,case when a.screenshot_review_status<>'' or not exists(select 1 from public.application_screenshots s where s.application_id=a.id) then 'SKIPPED' else 'PENDING' end,
      case when a.screenshot_review_status<>'' then 'Already reviewed; existing feedback preserved.' when not exists(select 1 from public.application_screenshots s where s.application_id=a.id) then 'No screenshots.' else '' end,
      case when a.screenshot_review_status<>'' or not exists(select 1 from public.application_screenshots s where s.application_id=a.id) then now() end
      from public.applications a where a.id=any(ids);
    return jsonb_build_object('id',b.id);
  elsif p_operation='list' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select batch_row.id,batch_row.created_at,batch_row.cancelled,batch_row.model,batch_row.prompt_version,count(i.id) total,
      count(*) filter(where i.status not in('PENDING','RUNNING')) finished,count(*) filter(where i.status='CORRECT') correct,
      count(*) filter(where i.status='HAS_MISTAKES') mistakes,count(*) filter(where i.status='CANNOT_VERIFY') uncertain,count(*) filter(where i.status='FAILED') failed
      from public.screenshot_review_batches batch_row left join public.screenshot_review_items i on i.batch_id=batch_row.id group by batch_row.id order by batch_row.created_at desc limit 100) x),'[]');
  elsif p_operation='history' then
    return coalesce((select jsonb_agg(to_jsonb(x)-'source_snapshot') from (select e.*,i.batch_id,batch_row.model,batch_row.prompt_version from public.screenshot_review_events e
      join public.screenshot_review_items i on i.id=e.item_id join public.screenshot_review_batches batch_row on batch_row.id=i.batch_id
      where i.application_id=(p_body->>'id')::uuid order by e.created_at desc limit 100) x),'[]');
  elsif p_operation='result' then
    return (select jsonb_build_object('result',result) from public.screenshot_review_items where id=(p_body->>'id')::uuid);
  end if;
  select * into b from public.screenshot_review_batches where id=(p_body->>'id')::uuid for update;
  if not found then raise exception 'SCREENSHOT_REVIEW_NOT_FOUND: Batch not found.'; end if;
  if p_operation='detail' then
    return jsonb_build_object('batch',to_jsonb(b),'items',coalesce((select jsonb_agg((to_jsonb(i)-'lease_token'-'source_snapshot'-'result')||jsonb_build_object(
      'has_result',i.result is not null,'application_number',a.application_number,'company',j.company,'job_title',j.job_title,'candidate_name',r.candidate_name) order by i.id)
      from public.screenshot_review_items i join public.applications a on a.id=i.application_id join public.resumes r on r.id=a.resume_id
      join public.job_descriptions j on j.id=a.job_description_id where i.batch_id=b.id),'[]'));
  elsif p_operation='ticket' and not b.cancelled then
    token:='srb_'||translate(rtrim(encode(gen_random_bytes(32),'base64'),'='),'+/','-_');
    delete from public.screenshot_review_tickets where batch_id=b.id;
    insert into public.screenshot_review_tickets(token_hash,batch_id,created_by) values(encode(digest(token,'sha256'),'hex'),b.id,auth.uid());
    return jsonb_build_object('ticket',token);
  elsif p_operation='retry' and not b.cancelled then
    -- Uncertain results need corrected screenshots/metadata and a new snapshot batch, not blind retries.
    update public.screenshot_review_items set status='PENDING',attempt_count=0,diagnostic='',lease_token=null,lease_expires_at=null,finished_at=null where batch_id=b.id and status='FAILED';
    return jsonb_build_object('id',b.id);
  elsif p_operation='cancel' then
    update public.screenshot_review_batches set cancelled=true where id=b.id;
    delete from public.screenshot_review_tickets where batch_id=b.id;
    update public.screenshot_review_items set status='SKIPPED',diagnostic='Batch cancelled.',finished_at=now(),lease_token=null where batch_id=b.id and status in('PENDING','RUNNING');
    return jsonb_build_object('id',b.id);
  end if;
  raise exception 'SCREENSHOT_REVIEW_INVALID: This operation is unavailable.';
end $$;
revoke all on function public.screenshot_review_manage(text,jsonb) from public,anon;
grant execute on function public.screenshot_review_manage(text,jsonb) to authenticated;

-- All runner operations require an expiring capability; no service-role key is distributed.
create function public.screenshot_review_runner(p_operation text,p_ticket text,p_body jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.screenshot_review_tickets; b public.screenshot_review_batches; i public.screenshot_review_items;
  source jsonb; raw jsonb; field jsonb; shot jsonb; outcome text; note text; old_feedback jsonb; n integer;
begin
  if coalesce(p_ticket,'') !~ '^srb_[A-Za-z0-9_-]{43}$' then raise exception 'SCREENSHOT_REVIEW_TICKET_INVALID: Generate a new command.'; end if;
  select * into t from public.screenshot_review_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex');
  if not found or t.expires_at<=now() then raise exception 'SCREENSHOT_REVIEW_TICKET_EXPIRED: Generate a new command.'; end if;
  if not public.is_active_user(t.created_by) or not (public.has_role('ADMIN',t.created_by) or public.has_role('APPLYING_MANAGER',t.created_by)) then
    raise exception 'SCREENSHOT_REVIEW_FORBIDDEN: Ticket owner no longer has manager access.' using errcode='42501';
  end if;
  select * into b from public.screenshot_review_batches where id=t.batch_id for update;
  if b.cancelled or not exists(select 1 from public.screenshot_review_tickets where token_hash=t.token_hash) then raise exception 'SCREENSHOT_REVIEW_CANCELLED: Command revoked or cancelled.'; end if;
  if p_operation='next' then
    for i in update public.screenshot_review_items set status='FAILED',diagnostic='LEASE_EXPIRED',finished_at=now()
      where batch_id=b.id and status='RUNNING' and lease_expires_at<=now() and attempt_count>=3 returning * loop
      insert into public.screenshot_review_events(item_id,attempt,status,diagnostic,initiated_by) values(i.id,i.attempt_count,i.status,i.diagnostic,t.created_by);
    end loop;
    loop
      select * into i from public.screenshot_review_items where batch_id=b.id and (status='PENDING' or (status='RUNNING' and lease_expires_at<=now())) order by id limit 1 for update;
      if not found then return jsonb_build_object('done',not exists(select 1 from public.screenshot_review_items where batch_id=b.id and status='RUNNING'),
        'failedCount',(select count(*) from public.screenshot_review_items where batch_id=b.id and status in('FAILED','CANNOT_VERIFY'))); end if;
      -- Consistent lock order for concurrent review batches and human edits.
      perform 1 from public.applications where id=i.application_id for update;
      source:=public.screenshot_review_source(i.application_id);
      if source is null or source->>'reviewStatus'<>'' or jsonb_array_length(source->'screenshots')=0 then
        update public.screenshot_review_items set status='SKIPPED',diagnostic='Already reviewed, missing profile or no screenshots.',finished_at=now() where id=i.id;
      else exit; end if;
    end loop;
    update public.screenshot_review_items set status='RUNNING',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',
      source_snapshot=source,started_at=now(),finished_at=null where id=i.id returning * into i;
    return jsonb_build_object('itemId',i.id,'leaseToken',i.lease_token,'source',source,'guide',b.guide_snapshot,'assumptions',b.assumptions,'model',b.model,'promptVersion',b.prompt_version);
  end if;
  select * into i from public.screenshot_review_items where id=(p_body->>'itemId')::uuid and batch_id=b.id for update;
  if not found or i.lease_token is distinct from (p_body->>'leaseToken')::uuid then raise exception 'SCREENSHOT_REVIEW_LEASE_INVALID: Item lease lost.'; end if;
  -- Repeated submission after a lost response is idempotent.
  if i.status not in('PENDING','RUNNING') then return jsonb_build_object('status',i.status); end if;
  if i.status<>'RUNNING' or i.lease_expires_at<=now() then raise exception 'SCREENSHOT_REVIEW_LEASE_EXPIRED: Item will be reclaimed.'; end if;
  if p_operation='fail' then
    note:=p_body->>'code';
    if coalesce(note,'') !~ '^[A-Z][A-Z0-9_]{1,80}$' then note:='WORKER_ERROR'; end if;
    outcome:='FAILED';
  elsif p_operation='submit' then
    raw:=p_body->'result';
    if raw is null or octet_length(raw::text)>200000 or jsonb_typeof(raw->'fields') is distinct from 'array'
      or jsonb_typeof(raw->'screenshots') is distinct from 'array' or jsonb_typeof(raw->'complete') is distinct from 'boolean'
      or jsonb_array_length(raw->'fields') not between 0 and 300 then raise exception 'SCREENSHOT_REVIEW_RESULT_INVALID: Missing field review or coverage.'; end if;
    if jsonb_array_length(raw->'screenshots')<>jsonb_array_length(i.source_snapshot->'screenshots') or
      exists(select 1 from jsonb_array_elements(i.source_snapshot->'screenshots') s where (select count(*) from jsonb_array_elements(raw->'screenshots') x where x->>'id'=s->>'id')<>1) then
      raise exception 'SCREENSHOT_REVIEW_RESULT_INVALID: Every screenshot must be accounted for.';
    end if;
    outcome:='CORRECT'; note:='AI reviewed visible pre-submission fields; not proof of submission.';
    for shot in select value from jsonb_array_elements(raw->'screenshots') loop
      if jsonb_typeof(shot->'readable') is distinct from 'boolean' or jsonb_typeof(shot->'complete') is distinct from 'boolean' then raise exception 'SCREENSHOT_REVIEW_RESULT_INVALID: Invalid screenshot coverage.'; end if;
      if shot->>'readable'<>'true' or shot->>'complete'<>'true' then outcome:='CANNOT_VERIFY'; end if;
    end loop;
    if raw->>'complete'<>'true' or jsonb_array_length(raw->'fields')=0 then outcome:='CANNOT_VERIFY'; end if;
    for field in select value from jsonb_array_elements(raw->'fields') loop
      if jsonb_typeof(field) is distinct from 'object' or jsonb_typeof(field->'observed') is distinct from 'string' or jsonb_typeof(field->'expected') is distinct from 'string'
        or jsonb_typeof(field->'field') is distinct from 'string' or jsonb_typeof(field->'reason') is distinct from 'string' or jsonb_typeof(field->'location') is distinct from 'string'
        or coalesce(field->>'verdict','') not in('CORRECT','INCORRECT','MISSING','CANNOT_VERIFY') or coalesce(field->>'basis','') not in('GUIDE','PROFILE','GPA_FORMAT','CITIZENSHIP_ASSUMPTION','NONE')
        or coalesce(char_length(field->>'field'),0) not between 1 and 200 or coalesce(char_length(field->>'reason'),0) not between 1 and 1000
        or coalesce(char_length(field->>'observed'),0)>2000 or coalesce(char_length(field->>'expected'),0)>2000
        or coalesce(char_length(field->>'location'),0) not between 1 and 200
        or not exists(select 1 from jsonb_array_elements(i.source_snapshot->'screenshots') s where s->>'id'=field->>'screenshotId') then
        raise exception 'SCREENSHOT_REVIEW_RESULT_INVALID: Invalid field evidence.';
      end if;
      if field->>'basis'='GUIDE' and not exists(select 1 from jsonb_array_elements(b.guide_snapshot) g where g->>'id'=field->>'guideId') then raise exception 'SCREENSHOT_REVIEW_RESULT_INVALID: Guide citation not in batch snapshot.'; end if;
      if field->>'verdict'='CANNOT_VERIFY' or field->>'basis'='NONE' then outcome:='CANNOT_VERIFY'; end if;
      if field->>'verdict' in('INCORRECT','MISSING') and outcome<>'CANNOT_VERIFY' then outcome:='HAS_MISTAKES'; end if;
    end loop;
    perform 1 from public.applications where id=i.application_id for update;
    source:=public.screenshot_review_source(i.application_id);
    if source is distinct from i.source_snapshot then outcome:='SKIPPED'; note:='Screenshots, profile, application or human feedback changed; create a fresh batch.';
    elsif outcome='CANNOT_VERIFY' then note:='Some fields or screenshot coverage could not be verified. Existing review status preserved.';
    elsif outcome in('CORRECT','HAS_MISTAKES') then
      select jsonb_build_object('status',screenshot_review_status,'feedback',screenshot_feedback,'by',screenshot_feedback_by,'at',screenshot_feedback_at) into old_feedback from public.applications where id=i.application_id;
      if outcome='HAS_MISTAKES' then
        select left('AI screenshot review: '||string_agg((f->>'field')||': '||(f->>'reason'),' | '),2000) into note from jsonb_array_elements(raw->'fields') f where f->>'verdict' in('INCORRECT','MISSING');
      end if;
      update public.applications set screenshot_review_status=outcome,screenshot_feedback=case when outcome='CORRECT' then '' else note end,
        screenshot_feedback_by=t.created_by,screenshot_feedback_at=now(),updated_at=now() where id=i.application_id;
    end if;
  else raise exception 'SCREENSHOT_REVIEW_INVALID: Unsupported runner operation.'; end if;
  update public.screenshot_review_items set status=outcome,diagnostic=note,result=raw,finished_at=now() where id=i.id;
  insert into public.screenshot_review_events(item_id,attempt,status,diagnostic,result,source_snapshot,previous_feedback,initiated_by) values(i.id,i.attempt_count,outcome,note,raw,i.source_snapshot,old_feedback,t.created_by);
  return jsonb_build_object('status',outcome);
end $$;
revoke all on function public.screenshot_review_runner(text,text,jsonb) from public;
grant execute on function public.screenshot_review_runner(text,text,jsonb) to anon,authenticated;

-- Short-lived storage access to ONLY the screenshots on the currently leased item.
-- Token and lease are headers on a fresh isolated client, never model input.
create function public.screenshot_review_storage_allowed(p_bucket text,p_path text) returns boolean
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare h jsonb;
begin
  if p_bucket<>'application-screenshots' then return false; end if;
  h:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  return exists(select 1 from public.screenshot_review_tickets t join public.screenshot_review_batches b on b.id=t.batch_id
    join public.screenshot_review_items i on i.batch_id=b.id
    where t.token_hash=encode(digest(h->>'x-screenshot-review-ticket','sha256'),'hex') and t.expires_at>now() and not b.cancelled
      and public.is_active_user(t.created_by) and (public.has_role('ADMIN',t.created_by) or public.has_role('APPLYING_MANAGER',t.created_by))
      and i.id::text=h->>'x-screenshot-review-item' and i.lease_token::text=h->>'x-screenshot-review-lease'
      and i.status='RUNNING' and i.lease_expires_at>now()
      and exists(select 1 from jsonb_array_elements(i.source_snapshot->'screenshots') s where s->>'path'=p_path));
end $$;
revoke all on function public.screenshot_review_storage_allowed(text,text) from public;
grant execute on function public.screenshot_review_storage_allowed(text,text) to anon,authenticated;
create policy "scoped screenshot AI review reads" on storage.objects for select to anon,authenticated
using(public.screenshot_review_storage_allowed(bucket_id,name));
