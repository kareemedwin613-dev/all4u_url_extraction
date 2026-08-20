-- v2.7: lightweight, auditable review workflow for captured job descriptions.

alter table public.job_descriptions
  add column if not exists review_status text,
  add column if not exists review_comment text,
  add column if not exists review_decline_reason text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

update public.job_descriptions
set review_status = case when status = 'ARCHIVED' then 'DECLINED' else 'APPROVED' end,
    review_decline_reason = case when status = 'ARCHIVED' then
      case archive_reason when 'EXPIRED' then 'EXPIRED' when 'DUPLICATE' then 'DUPLICATE' when 'NOT_APPLICABLE' then 'NOT_ELIGIBLE' else 'OTHER' end
      else null end
where review_status is null;

alter table public.job_descriptions alter column review_status set default 'NEEDS_REVIEW';
alter table public.job_descriptions alter column review_status set not null;
alter table public.job_descriptions drop constraint if exists job_descriptions_review_status_valid;
alter table public.job_descriptions add constraint job_descriptions_review_status_valid
  check (review_status in ('NEEDS_REVIEW','APPROVED','NEEDS_CORRECTION','DECLINED'));
alter table public.job_descriptions drop constraint if exists job_descriptions_review_decline_reason_valid;
alter table public.job_descriptions add constraint job_descriptions_review_decline_reason_valid
  check (review_decline_reason is null or review_decline_reason in ('EXPIRED','NOT_ELIGIBLE','DUPLICATE','INVALID_URL','OTHER'));
alter table public.job_descriptions drop constraint if exists job_descriptions_review_comment_length;
alter table public.job_descriptions add constraint job_descriptions_review_comment_length
  check (review_comment is null or char_length(review_comment) <= 1000);
alter table public.job_descriptions drop constraint if exists job_descriptions_review_state_consistent;
alter table public.job_descriptions add constraint job_descriptions_review_state_consistent check (
  (review_status='DECLINED' and review_decline_reason is not null and status='ARCHIVED') or
  (review_status<>'DECLINED' and review_decline_reason is null and status='ACTIVE')
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='job_descriptions_reviewed_by_profile_fkey' and conrelid='public.job_descriptions'::regclass) then
    alter table public.job_descriptions add constraint job_descriptions_reviewed_by_profile_fkey
      foreign key (reviewed_by) references public.profiles(id) on delete restrict;
  end if;
end $$;

create table if not exists public.job_description_review_history (
  id bigint generated always as identity primary key,
  job_description_id uuid not null references public.job_descriptions(id) on delete cascade,
  previous_status text,
  new_status text not null,
  decline_reason text,
  comment text,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  constraint job_description_review_history_previous_valid check (previous_status is null or previous_status in ('NEEDS_REVIEW','APPROVED','NEEDS_CORRECTION','DECLINED')),
  constraint job_description_review_history_new_valid check (new_status in ('NEEDS_REVIEW','APPROVED','NEEDS_CORRECTION','DECLINED')),
  constraint job_description_review_history_reason_valid check (decline_reason is null or decline_reason in ('EXPIRED','NOT_ELIGIBLE','DUPLICATE','INVALID_URL','OTHER')),
  constraint job_description_review_history_comment_length check (comment is null or char_length(comment) <= 1000)
);
alter table public.job_description_review_history enable row level security;
revoke all on public.job_description_review_history from public,anon;
revoke insert,update,delete on public.job_description_review_history from authenticated;
grant select on public.job_description_review_history to authenticated;

drop policy if exists "managers read job review history" on public.job_description_review_history;
create policy "managers read job review history" on public.job_description_review_history for select to authenticated
  using (public.has_any_role(array['APPLYING_MANAGER','ADMIN']));
drop policy if exists "finders read own job review history" on public.job_description_review_history;
create policy "finders read own job review history" on public.job_description_review_history for select to authenticated
  using (exists(select 1 from public.job_descriptions j where j.id=job_description_id and j.user_id=auth.uid()));

create or replace function public.initialize_job_description_review_v27()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Elevated reviewers may capture an immediately usable JD. A finder-only
  -- capture must always enter the review queue regardless of client input.
  if public.has_any_role(array['APPLYING_MANAGER','ADMIN']) then
    new.review_status := 'APPROVED';
    new.reviewed_by := auth.uid();
    new.reviewed_at := clock_timestamp();
  else
    new.review_status := 'NEEDS_REVIEW';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  new.review_comment := null;
  new.review_decline_reason := null;
  return new;
end $$;
revoke all on function public.initialize_job_description_review_v27() from public,anon,authenticated;
drop trigger if exists job_descriptions_initialize_review_v27 on public.job_descriptions;
create trigger job_descriptions_initialize_review_v27 before insert on public.job_descriptions
for each row execute function public.initialize_job_description_review_v27();

create or replace function public.maintain_job_description_review_v27()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.application_actor_can_manage() then
    raise exception 'JOB_REVIEW_FORBIDDEN: Only an Applying Manager or Admin can review captured jobs.' using errcode='42501';
  end if;
  if new.review_status='DECLINED' then
    if new.review_decline_reason not in ('EXPIRED','NOT_ELIGIBLE','DUPLICATE','INVALID_URL','OTHER') then
      raise exception 'JOB_REVIEW_REASON_INVALID: Select a decline reason.' using errcode='22023';
    end if;
    new.status := 'ARCHIVED';
    new.archive_reason := case new.review_decline_reason when 'EXPIRED' then 'EXPIRED' when 'DUPLICATE' then 'DUPLICATE' when 'NOT_ELIGIBLE' then 'NOT_APPLICABLE' else 'OTHER' end;
    new.archived_at := coalesce(new.archived_at,clock_timestamp());
    new.archived_by := auth.uid();
  else
    new.review_decline_reason := null;
    new.status := 'ACTIVE';
    new.archive_reason := null;
    new.archived_at := null;
    new.archived_by := null;
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.maintain_job_description_review_v27() from public,anon,authenticated;
drop trigger if exists job_descriptions_maintain_review_v27 on public.job_descriptions;
create trigger job_descriptions_maintain_review_v27
before update of review_status,review_comment,review_decline_reason on public.job_descriptions
for each row execute function public.maintain_job_description_review_v27();

create or replace function public.audit_job_description_review_v27()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.job_description_review_history(job_description_id,previous_status,new_status,decline_reason,comment,reviewed_by,reviewed_at)
  values(new.id,old.review_status,new.review_status,new.review_decline_reason,new.review_comment,new.reviewed_by,new.reviewed_at);
  return new;
end $$;
revoke all on function public.audit_job_description_review_v27() from public,anon,authenticated;
drop trigger if exists job_descriptions_audit_review_v27 on public.job_descriptions;
create trigger job_descriptions_audit_review_v27
after update of review_status,review_comment,review_decline_reason on public.job_descriptions
for each row when (old.review_status is distinct from new.review_status or old.review_comment is distinct from new.review_comment or old.review_decline_reason is distinct from new.review_decline_reason)
execute function public.audit_job_description_review_v27();

create or replace function public.review_job_description_v27(
  p_job_description_id uuid,
  p_review_status text,
  p_decline_reason text default null,
  p_comment text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_new text := upper(btrim(coalesce(p_review_status,'')));
  v_reason text := nullif(upper(btrim(coalesce(p_decline_reason,''))), '');
  v_comment text := nullif(btrim(coalesce(p_comment,'')), '');
  v_job public.job_descriptions;
  v_archive_reason text;
begin
  perform public.assert_application_manager();
  if p_job_description_id is null or v_new not in ('NEEDS_REVIEW','APPROVED','NEEDS_CORRECTION','DECLINED') then
    raise exception 'JOB_REVIEW_INVALID: Select a job and valid review decision.' using errcode='22023';
  end if;
  if v_new='DECLINED' and v_reason not in ('EXPIRED','NOT_ELIGIBLE','DUPLICATE','INVALID_URL','OTHER') then
    raise exception 'JOB_REVIEW_REASON_INVALID: Select a decline reason.' using errcode='22023';
  end if;
  if v_new<>'DECLINED' then v_reason := null; end if;
  if char_length(coalesce(v_comment,'')) > 1000 then
    raise exception 'JOB_REVIEW_COMMENT_INVALID: Comments may contain at most 1000 characters.' using errcode='22023';
  end if;

  select * into v_job from public.job_descriptions where id=p_job_description_id for update;
  if not found then raise exception 'JOB_NOT_FOUND: The job description was not found.' using errcode='P0002'; end if;
  v_archive_reason := case v_reason when 'EXPIRED' then 'EXPIRED' when 'DUPLICATE' then 'DUPLICATE' when 'NOT_ELIGIBLE' then 'NOT_APPLICABLE' else 'OTHER' end;

  update public.job_descriptions set
    review_status=v_new,
    review_comment=v_comment,
    review_decline_reason=v_reason,
    reviewed_by=auth.uid(),
    reviewed_at=clock_timestamp(),
    status=case when v_new='DECLINED' then 'ARCHIVED' else 'ACTIVE' end,
    archive_reason=case when v_new='DECLINED' then v_archive_reason else null end
  where id=p_job_description_id returning * into v_job;

  return jsonb_build_object('id',v_job.id,'review_status',v_job.review_status,'review_comment',v_job.review_comment,
    'review_decline_reason',v_job.review_decline_reason,'reviewed_by',v_job.reviewed_by,'reviewed_at',v_job.reviewed_at,
    'status',v_job.status,'archive_reason',v_job.archive_reason,'archived_at',v_job.archived_at,'archived_by',v_job.archived_by,
    'updated_at',v_job.updated_at);
end $$;
revoke all on function public.review_job_description_v27(uuid,text,text,text) from public,anon;
grant execute on function public.review_job_description_v27(uuid,text,text,text) to authenticated;

-- Preserve the v2.4 endpoint/RPC contract while routing it through the new
-- audited decision workflow.
create or replace function public.set_job_description_archived_state_v24(
  p_job_description_id uuid,p_status text,p_reason text default null
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if upper(btrim(coalesce(p_status,'')))='ACTIVE' then
    return public.review_job_description_v27(p_job_description_id,'APPROVED',null,null);
  end if;
  if upper(btrim(coalesce(p_status,'')))<>'ARCHIVED' then
    raise exception 'JOB_REVIEW_INVALID: Select a valid URL status.' using errcode='22023';
  end if;
  return public.review_job_description_v27(p_job_description_id,'DECLINED',
    case upper(btrim(coalesce(p_reason,'NOT_APPLICABLE')))
      when 'NOT_APPLICABLE' then 'NOT_ELIGIBLE' when 'EXPIRED' then 'EXPIRED'
      when 'DUPLICATE' then 'DUPLICATE' else 'OTHER' end,null);
end $$;
revoke all on function public.set_job_description_archived_state_v24(uuid,text,text) from public,anon;
grant execute on function public.set_job_description_archived_state_v24(uuid,text,text) to authenticated;

create or replace function public.require_active_job_description_for_application_v24()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.job_descriptions where id=new.job_description_id and status='ACTIVE' and review_status='APPROVED') then
    raise exception 'APPLICATION_UNAPPROVED_JOB: Approve the job description before creating an Application.' using errcode='P0001';
  end if;
  return new;
end $$;

create or replace function public.list_application_jobs(p_search text default '', p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.company,x.job_title),'[]'::jsonb) into v_result from(
    select j.id,j.company,j.job_title,j.category_id,j.status
    from public.job_descriptions j
    where j.status='ACTIVE' and j.review_status='APPROVED'
      and (coalesce(trim(p_search),'')='' or j.search_vector @@ websearch_to_tsquery('english',trim(p_search)))
    order by j.company,j.job_title limit least(greatest(coalesce(p_limit,100),1),200)
  )x;
  return v_result;
end $$;
revoke all on function public.list_application_jobs(text,integer) from public,anon;
grant execute on function public.list_application_jobs(text,integer) to authenticated;

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ids uuid[];v_limit constant integer:=100;v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids from(select distinct id from unnest(coalesce(p_selected_jd_ids,array[]::uuid[])) ids(id) where id is not null)x;
  if cardinality(v_ids)=0 then raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode='22023';end if;
  if cardinality(v_ids)>v_limit then raise exception 'BULK_JD_LIMIT: You can select up to 100 job descriptions in one bulk operation.' using errcode='22023';end if;
  with requested as(select id from unnest(v_ids) requested_ids(id)),loaded as(
    select requested.id requested_id,jobs.id,jobs.company,jobs.job_title,jobs.category_id,jobs.status,jobs.review_status,categories.name category_name
    from requested left join public.job_descriptions jobs on jobs.id=requested.id
    left join public.categories categories on categories.id=jobs.category_id and categories.active
  ),combinations as(
    select concat(loaded.id,':',resumes.id) key,loaded.id job_description_id,resumes.id resume_id,loaded.company,loaded.job_title,
      loaded.category_id job_category_id,loaded.category_name job_category_name,resumes.resume_number,resumes.resume_type,
      resumes.candidate_name,resumes.resume_name,resumes.primary_category_id resume_category_id,resume_categories.name resume_category_name,
      applications.id existing_application_id,applications.id is null eligible,
      case when applications.id is not null then 'EXISTING_APPLICATION' end exclusion_code,
      case when applications.id is not null then 'Application already exists' end exclusion_reason
    from loaded join public.resumes resumes on resumes.primary_category_id=loaded.category_id and resumes.status='ACTIVE' and resumes.resume_type='ORIGINAL'
    left join public.categories resume_categories on resume_categories.id=resumes.primary_category_id
    left join public.applications applications on applications.job_description_id=loaded.id
      and coalesce((select parent_resume_id from public.resumes where id=applications.resume_id),applications.resume_id)=resumes.id
    where loaded.id is not null and loaded.status='ACTIVE' and loaded.review_status='APPROVED'
      and loaded.category_id is not null and loaded.category_name is not null
  ),invalid_jds as(
    select loaded.requested_id job_description_id,coalesce(loaded.company,'Unavailable job description') company,coalesce(loaded.job_title,'Unavailable') job_title,
      case when loaded.id is null then 'MISSING_JD' when loaded.status<>'ACTIVE' then 'INACTIVE_JD'
        when loaded.review_status<>'APPROVED' then 'UNAPPROVED_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY' else 'NO_MATCHING_ACTIVE_RESUMES' end code,
      case when loaded.id is null then 'The job description does not exist or is unavailable.' when loaded.status<>'ACTIVE' then 'The job description is archived.'
        when loaded.review_status<>'APPROVED' then 'The job description has not been approved.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.' else 'No active original Resumes have the same primary category.' end reason
    from loaded where loaded.id is null or loaded.status<>'ACTIVE' or loaded.review_status<>'APPROVED' or loaded.category_id is null or loaded.category_name is null
      or not exists(select 1 from combinations where combinations.job_description_id=loaded.id)
  ) select jsonb_build_object('selectedJdCount',cardinality(v_ids),'validJdCount',cardinality(v_ids)-(select count(*) from invalid_jds),
    'invalidJdCount',(select count(*) from invalid_jds),'activeResumeCount',(select count(distinct resume_id) from combinations),
    'proposedCount',(select count(*) from combinations),'eligibleCount',(select count(*) from combinations where eligible),
    'duplicateCount',(select count(*) from combinations where not eligible),'excludedCount',(select count(*) from combinations where not eligible)+(select count(*) from invalid_jds),
    'combinations',coalesce((select jsonb_agg(jsonb_build_object('key',key,'jobDescriptionId',job_description_id,'resumeId',resume_id,'resumeNumber',resume_number,'resumeType',resume_type,
      'company',company,'jobTitle',job_title,'jobCategoryId',job_category_id,'jobCategoryName',job_category_name,'candidateName',candidate_name,'resumeName',resume_name,
      'resumeCategoryId',resume_category_id,'resumeCategoryName',resume_category_name,'eligible',eligible,'existingApplicationId',existing_application_id,
      'exclusionCode',exclusion_code,'exclusionReason',exclusion_reason)order by company,job_title,candidate_name,resume_name)from combinations),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',job_description_id,'company',company,'jobTitle',job_title,'code',code,'reason',reason)order by company,job_title)from invalid_jds),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.preview_bulk_applications(uuid[]) from public,anon;
grant execute on function public.preview_bulk_applications(uuid[]) to authenticated;

create index if not exists job_descriptions_review_queue_idx on public.job_descriptions(review_status,created_at,id);
create index if not exists job_descriptions_review_queue_user_idx on public.job_descriptions(user_id,review_status,created_at,id);
create index if not exists job_description_review_history_job_idx on public.job_description_review_history(job_description_id,reviewed_at desc,id desc);

comment on column public.job_descriptions.review_status is 'Simple manager review state: NEEDS_REVIEW, APPROVED, NEEDS_CORRECTION, or DECLINED.';
comment on table public.job_description_review_history is 'Append-only audit history of manager/admin JD review decisions.';
