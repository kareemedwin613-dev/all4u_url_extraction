-- v3.105: classify saved JD text and fill blank metadata only.
-- Preserve v1 batches/history; new v2 batches do not visit URLs or make blocking decisions.
alter table public.jd_review_batches alter column prompt_version set default 'jd-classify-v2';

create or replace function public.jd_review_manage(p_operation text,p_body jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare b public.jd_review_batches; token text; ids uuid[]; batch_id uuid;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) or not public.application_actor_can_manage() then
    raise exception 'JD_REVIEW_FORBIDDEN: An active Applying Manager or Admin is required.' using errcode='42501';
  end if;
  if p_operation='create' then
    select array_agg(distinct x::uuid) into ids from jsonb_array_elements_text(p_body->'jobDescriptionIds') x;
    if coalesce(cardinality(ids),0) not between 1 and 1000 then raise exception 'JD_REVIEW_INVALID: Select 1 to 1000 JDs.'; end if;
    if exists(select 1 from unnest(ids) x where not exists(select 1 from public.job_descriptions where id=x)) then
      raise exception 'JD_REVIEW_NOT_FOUND: A selected JD no longer exists.';
    end if;
    insert into public.jd_review_batches(created_by) values(auth.uid()) returning * into b;
    insert into public.jd_review_items(batch_id,job_description_id,status,comment,finished_at)
      select b.id,j.id,case when assigned then 'SKIPPED' else 'PENDING' end,
        case when assigned then 'Skipped: this JD already has an assigned application.' end,
        case when assigned then now() end
      from public.job_descriptions j cross join lateral
        (select exists(select 1 from public.applications a where a.job_description_id=j.id and a.assigned_to is not null) assigned) q
      where j.id=any(ids);
    return to_jsonb(b);
  elsif p_operation='list' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select batch_row.*,count(i.id) as total,count(i.id) filter(where i.status not in('PENDING','RUNNING')) as finished,
        count(i.id) filter(where i.status='NEEDS_ATTENTION') as needs_attention
      from public.jd_review_batches batch_row left join public.jd_review_items i on i.batch_id=batch_row.id
      group by batch_row.id order by batch_row.created_at desc limit 100) x),'[]');
  end if;
  batch_id := (p_body->>'id')::uuid;
  select * into b from public.jd_review_batches where id=batch_id for update;
  if not found then raise exception 'JD_REVIEW_NOT_FOUND: Review batch not found.'; end if;
  if p_operation in ('ticket','retry') and b.prompt_version<>'jd-classify-v2' then
    raise exception 'JD_REVIEW_LEGACY_BATCH: Create a saved-JD classification batch. Old review history is preserved.';
  end if;
  if p_operation='detail' then
    return jsonb_build_object('batch',to_jsonb(b),'items',coalesce((select jsonb_agg(
      (to_jsonb(i)-'lease_token'-'before_value'-'after_value') || jsonb_build_object(
        'company',j.company,'job_title',j.job_title,
        'changes',i.result->'changes',
        'fieldChanges',(select jsonb_object_agg(k,jsonb_build_object('before',i.before_value->k,'after',i.after_value->k))
          from jsonb_object_keys(coalesce(i.result->'changes','{}')) k)) order by i.id)
      from public.jd_review_items i left join public.job_descriptions j on j.id=i.job_description_id
      where i.batch_id=b.id),'[]'));
  elsif p_operation='ticket' then
    if b.cancelled then raise exception 'JD_REVIEW_CANCELLED: This batch was cancelled.'; end if;
    delete from public.jd_review_tickets where jd_review_tickets.batch_id=b.id;
    token := 'jrb_' || translate(rtrim(encode(gen_random_bytes(32),'base64'),'='),'+/','-_');
    insert into public.jd_review_tickets(token_hash,batch_id,created_by) values(encode(digest(token,'sha256'),'hex'),b.id,auth.uid());
    return jsonb_build_object('ticket',token,'expiresAt',now()+interval '24 hours');
  elsif p_operation='cancel' then
    update public.jd_review_batches set cancelled=true where id=b.id;
    delete from public.jd_review_tickets where jd_review_tickets.batch_id=b.id;
    update public.jd_review_items set status='CANCELLED',finished_at=now() where jd_review_items.batch_id=b.id and status in('PENDING','RUNNING');
    return jsonb_build_object('cancelled',true);
  elsif p_operation='retry' then
    if b.cancelled then raise exception 'JD_REVIEW_CANCELLED: Create a new batch for cancelled work.'; end if;
    update public.jd_review_items set status='PENDING',attempt_count=0,lease_token=null,lease_expires_at=null,finished_at=null
      where jd_review_items.batch_id=b.id and status='NEEDS_ATTENTION';
    return jsonb_build_object('retried',true);
  end if;
  raise exception 'JD_REVIEW_INVALID: Unknown operation.';
end $$;
revoke all on function public.jd_review_manage(text,jsonb) from public,anon;
grant execute on function public.jd_review_manage(text,jsonb) to authenticated;

create or replace function public.jd_review_runner(p_operation text,p_ticket text,p_body jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.jd_review_tickets; b public.jd_review_batches; i public.jd_review_items;
  j public.job_descriptions; n public.job_descriptions; snapshot jsonb; changes jsonb; outcome text; note text;
  subs uuid[]; v_result jsonb; key text; old_value jsonb;
begin
  if coalesce(p_ticket,'') !~ '^jrb_[A-Za-z0-9_-]{43}$' then raise exception 'JD_REVIEW_TICKET_INVALID: Generate a new command.'; end if;
  select * into t from public.jd_review_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex');
  if not found or t.expires_at<=now() then raise exception 'JD_REVIEW_TICKET_EXPIRED: Generate a new command.'; end if;
  -- Only the scoped ticket supplies actor identity, never worker input.
  perform set_config('request.jwt.claim.sub',t.created_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',t.created_by,'role','authenticated')::text,true);
  if not public.is_active_user(t.created_by) or not public.application_actor_can_manage() then
    raise exception 'JD_REVIEW_FORBIDDEN: The ticket owner no longer has manager access.' using errcode='42501';
  end if;
  -- Serializes cancel/ticket rotation with submission. Model/fetch work is outside transactions.
  select * into b from public.jd_review_batches where id=t.batch_id for update;
  if b.cancelled or not exists(select 1 from public.jd_review_tickets where token_hash=t.token_hash) then
    raise exception 'JD_REVIEW_CANCELLED: This command is no longer active.';
  end if;
  if b.prompt_version<>'jd-classify-v2' then
    raise exception 'JD_REVIEW_LEGACY_BATCH: This URL-review batch is read-only. Create a saved-JD classification batch.';
  end if;
  if p_operation='next' then
    update public.jd_review_items set status='NEEDS_ATTENTION',comment='Worker lease expired after three attempts; retry after checking worker logs.',finished_at=now()
      where batch_id=b.id and status='RUNNING' and lease_expires_at<=now() and attempt_count>=3;
    loop
      select * into i from public.jd_review_items where batch_id=b.id
        and (status='PENDING' or (status='RUNNING' and lease_expires_at<=now())) order by id for update skip locked limit 1;
      if not found then
        return jsonb_build_object('done',not exists(select 1 from public.jd_review_items where batch_id=b.id and status in('PENDING','RUNNING')),
          'needsAttention',(select count(*) from public.jd_review_items where batch_id=b.id and status='NEEDS_ATTENTION'));
      end if;
      select * into j from public.job_descriptions where id=i.job_description_id for update;
      if not found or exists(select 1 from public.applications where job_description_id=j.id and assigned_to is not null) then
        update public.jd_review_items set status='SKIPPED',comment='Skipped: JD missing or an application is already assigned.',finished_at=now() where id=i.id;
        continue;
      end if;
      -- Existing declined/blocked decisions are never silently reopened.
      if j.status='ARCHIVED' or j.application_blocked_at is not null then
        update public.jd_review_items set status='SKIPPED',comment='Skipped: JD is already archived or blocked.',finished_at=now() where id=i.id;
        continue;
      end if;
      snapshot := public.jd_review_snapshot(j.id);
      update public.jd_review_items set status='RUNNING',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),
        lease_expires_at=now()+interval '5 minutes',started_at=now(),before_value=snapshot
        where id=i.id returning * into i;
      return jsonb_build_object('itemId',i.id,'leaseToken',i.lease_token,'job',snapshot,'model',b.model,'promptVersion',b.prompt_version,
        'categories',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'parent_id',parent_id,'slug',slug)) from public.categories where active),
        'industries',(select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.industry_domain_categories where active));
    end loop;
  elsif p_operation='submit' then
    select * into i from public.jd_review_items where id=(p_body->>'itemId')::uuid and batch_id=b.id for update;
    if not found or i.lease_token is distinct from (p_body->>'leaseToken')::uuid then raise exception 'JD_REVIEW_LEASE_INVALID: This result has an obsolete lease.'; end if;
    if i.status not in('PENDING','RUNNING') then return jsonb_build_object('status',i.status); end if; -- idempotent retry
    if i.lease_expires_at<=now() then raise exception 'JD_REVIEW_LEASE_EXPIRED: The item will be retried.'; end if;
    select * into j from public.job_descriptions where id=i.job_description_id for update;
    -- Lock existing applications to prevent a concurrent assignment during the final check.
    perform 1 from public.applications where job_description_id=j.id order by id for update;
    if j.id is null or exists(select 1 from public.applications where job_description_id=j.id and assigned_to is not null) then
      update public.jd_review_items set status='SKIPPED',comment='Skipped before saving: JD missing or an application is already assigned.',finished_at=now() where id=i.id;
      return jsonb_build_object('status','SKIPPED');
    end if;
    if public.jd_review_snapshot(j.id) is distinct from i.before_value then
      update public.jd_review_items set status='NEEDS_ATTENTION',comment='JD changed during review. No fields or review decision were overwritten.',finished_at=now() where id=i.id;
      return jsonb_build_object('status','NEEDS_ATTENTION');
    end if;
    v_result := p_body->'result'; outcome := v_result->>'outcome'; changes := coalesce(v_result->'changes','{}');
    if outcome is null or outcome not in('APPROVED','NEEDS_ATTENTION') or jsonb_typeof(changes)<>'object'
      or length(coalesce(v_result->>'comment','')) not between 1 and 800 or octet_length(v_result::text)>60000 then
      raise exception 'JD_REVIEW_RESULT_INVALID: Invalid review result.';
    end if;
    if coalesce(v_result->'verification'->>'source','')<>'SAVED_JD'
      or v_result->'verification'->'liveUrlChecked' is distinct from 'false'::jsonb then
      raise exception 'JD_REVIEW_RESULT_INVALID: Updated saved-JD worker required; URL review is disabled.';
    end if;
    for key in select jsonb_object_keys(changes) loop
      if key not in('category_id','subcategory_ids','industry_domain_category_id','seniority','location_text','work_arrangement',
        'detected_skills','clearance_requirements','travel_required','travel_details','salary_min','salary_max','salary_currency','salary_period','salary_text') then
        raise exception 'JD_REVIEW_RESULT_INVALID: Unsupported field.';
      end if;
      if key not in ('category_id','subcategory_ids') then
        old_value := to_jsonb(j)->key;
        if not (old_value is null or old_value='null'::jsonb or old_value='[]'::jsonb
          or (jsonb_typeof(old_value)='string' and upper(btrim(old_value#>>'{}')) in ('','UNSPECIFIED'))) then
          raise exception 'JD_REVIEW_RESULT_INVALID: Populated fields cannot be overwritten.';
        end if;
      end if;
    end loop;
    note := left(format('AI saved-JD classification [%s, %s; item %s]: Live posting availability not checked. %s',b.prompt_version,b.model,i.id,v_result->>'comment'),1000);
    if outcome='APPROVED' then
      n := jsonb_populate_record(j, changes-'subcategory_ids');
      if not exists(select 1 from public.categories where id=n.category_id and active and parent_id is null)
        or (changes ? 'industry_domain_category_id' and n.industry_domain_category_id is not null and not exists(select 1 from public.industry_domain_categories where id=n.industry_domain_category_id and active)) then
        raise exception 'JD_REVIEW_RESULT_INVALID: Use only active taxonomy values.';
      end if;
      subs := case when changes ? 'subcategory_ids' then array(select jsonb_array_elements_text(changes->'subcategory_ids')::uuid)
        else public.job_description_subcategory_ids(j.id) end;
      if not exists(select 1 from public.categories where id=n.category_id and slug='software-engineering') then
        subs := array[]::uuid[];
        if cardinality(public.job_description_subcategory_ids(j.id))>0 or changes ? 'subcategory_ids' then
          changes := jsonb_set(changes,'{subcategory_ids}','[]');
          v_result := jsonb_set(v_result,'{changes}',changes);
        end if;
      end if;
      -- Clear legacy subtype before changing its primary; junction is replaced in this transaction.
      update public.job_descriptions set category_id=n.category_id,subcategory_id=null,
        industry_domain_category_id=n.industry_domain_category_id,seniority=n.seniority,location_text=n.location_text,work_arrangement=n.work_arrangement,
        detected_skills=n.detected_skills,clearance_requirements=n.clearance_requirements,travel_required=n.travel_required,travel_details=n.travel_details,
        salary_min=n.salary_min,salary_max=n.salary_max,salary_currency=n.salary_currency,salary_period=n.salary_period,salary_text=n.salary_text
        where id=j.id;
      perform public.replace_job_description_subcategories(j.id,n.category_id,subs,true);
    else
      -- Uncertainty never changes captured facts, even if a worker proposed edits.
      v_result := jsonb_set(v_result,'{changes}','{}');
    end if;
    update public.job_descriptions set
      review_status=case outcome when 'APPROVED' then 'APPROVED' else 'NEEDS_CORRECTION' end,
      review_decline_reason=null,
      review_comment=note
      where id=j.id;
    update public.jd_review_items set status=outcome,result=v_result,comment=note,after_value=public.jd_review_snapshot(j.id),finished_at=now()
      where id=i.id;
    return jsonb_build_object('status',outcome);
  end if;
  raise exception 'JD_REVIEW_INVALID: Unknown runner operation.';
end $$;
revoke all on function public.jd_review_runner(text,text,jsonb) from public;
grant execute on function public.jd_review_runner(text,text,jsonb) to anon,authenticated;

