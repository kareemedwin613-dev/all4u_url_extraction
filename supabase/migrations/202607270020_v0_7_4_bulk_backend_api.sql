-- v0.7.4: durable API idempotency and bounded batch read RPCs.
-- Existing set-based preview/create functions and their authoritative defaults remain unchanged.

alter table public.application_creation_batches
  add column idempotency_key text,
  add column request_hash text,
  add constraint application_creation_batches_idempotency_key_length
    check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  add constraint application_creation_batches_request_hash_format
    check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  add constraint application_creation_batches_idempotency_pair
    check ((idempotency_key is null) = (request_hash is null));

create unique index application_creation_batches_actor_idempotency_uidx
  on public.application_creation_batches(created_by, idempotency_key)
  where idempotency_key is not null;

comment on column public.application_creation_batches.idempotency_key is
  'Caller-scoped API retry key; never contains an access token or credential.';
comment on column public.application_creation_batches.request_hash is
  'SHA-256 of the normalized public bulk-create payload for conflict detection.';

create or replace function public.create_applications_bulk_api(
  p_combinations jsonb,
  p_batch_name text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.application_creation_batches;
  v_result jsonb;
begin
  perform public.assert_application_manager();
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'VALIDATION_ERROR: A valid Idempotency-Key is required.' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: A valid request hash is required.' using errcode = '22023';
  end if;

  -- Serializes only retries for this actor/key; unrelated bulk requests remain concurrent.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key, 0));
  select * into v_existing
  from public.application_creation_batches
  where created_by = v_actor and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: This idempotency key was already used with a different request.' using errcode = '23505';
    end if;
    select jsonb_build_object(
      'batchId', v_existing.id, 'batchName', v_existing.name, 'status', v_existing.status,
      'selectedJdCount', v_existing.selected_jd_count,
      'requestedCount', v_existing.requested_combination_count,
      'createdCount', v_existing.created_application_count,
      'duplicateCount', v_existing.duplicate_count,
      'skippedCount', v_existing.skipped_count,
      'failedCount', v_existing.failed_count,
      'replayed', true,
      'results', coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.pair_key,
        'jobDescriptionId', coalesce(r.job_description_id::text, r.requested_job_description_id),
        'resumeId', coalesce(r.resume_id::text, r.requested_resume_id),
        'applicationId', r.application_id, 'company', r.company, 'jobTitle', r.job_title,
        'candidateName', r.candidate_name, 'resumeName', r.resume_name,
        'outcome', r.outcome, 'code', r.code, 'message', r.message
      ) order by r.created_at, r.id)
      from public.application_creation_batch_results r where r.batch_id = v_existing.id), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  v_result := public.create_applications_bulk(p_combinations, p_batch_name);
  update public.application_creation_batches
  set idempotency_key = p_idempotency_key, request_hash = p_request_hash
  where id = (v_result ->> 'batchId')::uuid and created_by = v_actor;
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.list_application_batches_v074(
  p_search text default '', p_status text default '', p_created_by uuid default null,
  p_created_from timestamptz default null, p_created_to timestamptz default null,
  p_sort text default 'created_desc', p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_sort text := lower(coalesce(p_sort,'created_desc'));
  v_items jsonb; v_total bigint;
begin
  perform public.assert_application_manager();
  if coalesce(p_status,'') <> '' and upper(p_status) not in ('PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED') then
    raise exception 'VALIDATION_ERROR: Select a valid batch status.' using errcode='22023';
  end if;
  if v_sort not in ('name_asc','name_desc','creator_asc','creator_desc','created_asc','created_desc',
    'selected_asc','selected_desc','requested_asc','requested_desc','created_count_asc','created_count_desc',
    'duplicate_asc','duplicate_desc','skipped_asc','skipped_desc','failed_asc','failed_desc','status_asc','status_desc') then
    raise exception 'VALIDATION_ERROR: Select a valid batch sort.' using errcode='22023';
  end if;
  with filtered as (
    select b.*, coalesce(nullif(p.full_name,''),p.email) creator_name
    from public.application_creation_batches b join public.profiles p on p.id=b.created_by
    where (coalesce(btrim(p_search),'')='' or b.name ilike '%'||btrim(p_search)||'%')
      and (coalesce(p_status,'')='' or b.status=upper(p_status))
      and (p_created_by is null or b.created_by=p_created_by)
      and (p_created_from is null or b.created_at>=p_created_from)
      and (p_created_to is null or b.created_at<=p_created_to)
  ), paged as (
    select * from filtered order by
      case when v_sort='name_asc' then name end asc nulls last, case when v_sort='name_desc' then name end desc nulls last,
      case when v_sort='creator_asc' then creator_name end asc, case when v_sort='creator_desc' then creator_name end desc,
      case when v_sort='created_asc' then created_at end asc, case when v_sort='created_desc' then created_at end desc,
      case when v_sort='selected_asc' then selected_jd_count end asc, case when v_sort='selected_desc' then selected_jd_count end desc,
      case when v_sort='requested_asc' then requested_combination_count end asc, case when v_sort='requested_desc' then requested_combination_count end desc,
      case when v_sort='created_count_asc' then created_application_count end asc, case when v_sort='created_count_desc' then created_application_count end desc,
      case when v_sort='duplicate_asc' then duplicate_count end asc, case when v_sort='duplicate_desc' then duplicate_count end desc,
      case when v_sort='skipped_asc' then skipped_count end asc, case when v_sort='skipped_desc' then skipped_count end desc,
      case when v_sort='failed_asc' then failed_count end asc, case when v_sort='failed_desc' then failed_count end desc,
      case when v_sort='status_asc' then status end asc, case when v_sort='status_desc' then status end desc,
      id desc limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb), (select count(*) from filtered)
  into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',coalesce(v_total,0));
end;
$$;

create or replace function public.get_application_batch_summary_v074(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select jsonb_build_object(
    'batch',to_jsonb(b)||jsonb_build_object('creator_name',coalesce(nullif(p.full_name,''),p.email)),
    'applications',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'application_number',a.application_number,'company',j.company,'job_title',j.job_title
    ) order by a.application_number) from public.applications a join public.job_descriptions j on j.id=a.job_description_id where a.creation_batch_id=b.id),'[]'::jsonb)
  ) into v_result
  from public.application_creation_batches b join public.profiles p on p.id=b.created_by where b.id=p_batch_id;
  if v_result is null then raise exception 'BULK_BATCH_NOT_FOUND: The Application batch was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.list_application_batch_results_v074(
  p_batch_id uuid, p_outcome text default '', p_company text default '', p_job_title text default '',
  p_candidate text default '', p_resume text default '', p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,25),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  perform public.assert_application_manager();
  if not exists(select 1 from public.application_creation_batches where id=p_batch_id) then
    raise exception 'BULK_BATCH_NOT_FOUND: The Application batch was not found.' using errcode='P0001';
  end if;
  if coalesce(p_outcome,'')<>'' and upper(p_outcome) not in ('CREATED','DUPLICATE','SKIPPED','FAILED') then
    raise exception 'VALIDATION_ERROR: Select a valid outcome.' using errcode='22023';
  end if;
  with filtered as (
    select id,pair_key,requested_job_description_id,requested_resume_id,job_description_id,resume_id,application_id,
      company,job_title,candidate_name,resume_name,outcome,code,message,created_at
    from public.application_creation_batch_results
    where batch_id=p_batch_id and (coalesce(p_outcome,'')='' or outcome=upper(p_outcome))
      and (coalesce(btrim(p_company),'')='' or company ilike '%'||btrim(p_company)||'%')
      and (coalesce(btrim(p_job_title),'')='' or job_title ilike '%'||btrim(p_job_title)||'%')
      and (coalesce(btrim(p_candidate),'')='' or candidate_name ilike '%'||btrim(p_candidate)||'%')
      and (coalesce(btrim(p_resume),'')='' or resume_name ilike '%'||btrim(p_resume)||'%')
  ), paged as (select * from filtered order by created_at,id limit v_limit offset v_offset)
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),(select count(*) from filtered) into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',coalesce(v_total,0));
end;
$$;

revoke all on function public.create_applications_bulk_api(jsonb,text,text,text) from public,anon;
revoke all on function public.list_application_batches_v074(text,text,uuid,timestamptz,timestamptz,text,integer,integer) from public,anon;
revoke all on function public.get_application_batch_summary_v074(uuid) from public,anon;
revoke all on function public.list_application_batch_results_v074(uuid,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.create_applications_bulk_api(jsonb,text,text,text) to authenticated;
grant execute on function public.list_application_batches_v074(text,text,uuid,timestamptz,timestamptz,text,integer,integer) to authenticated;
grant execute on function public.get_application_batch_summary_v074(uuid) to authenticated;
grant execute on function public.list_application_batch_results_v074(uuid,text,text,text,text,text,integer,integer) to authenticated;
