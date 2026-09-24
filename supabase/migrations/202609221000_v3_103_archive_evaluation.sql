-- Archive evaluation without deleting assessments, tickets, or creation history.
-- Existing workers lose queue access; category creation and PDF generation remain.
set local lock_timeout = '3s';

alter table public.applications alter column matching_mode set default 'CATEGORY';
alter table public.application_creation_batches alter column matching_mode set default 'CATEGORY';

create or replace function public.request_application_matches(p_combinations jsonb,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'EVALUATION_ARCHIVED: Use category/subcategory matching.' using errcode='P0001'; end $$;

create or replace function public.request_application_matches_with_ticket(p_combinations jsonb,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'EVALUATION_ARCHIVED: Use category/subcategory matching.' using errcode='P0001'; end $$;

create or replace function public.request_application_match_comparison_v378(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'EVALUATION_ARCHIVED: Historical scores are read-only.' using errcode='P0001'; end $$;

create or replace function public.application_match_runner_call(p_ticket text,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'EVALUATION_ARCHIVED: AI evaluation has been archived.' using errcode='P0001'; end $$;

create or replace function public.claim_application_match(p_model_id text,p_rubric_version text default 'match-v1',p_extractor_version text default 'facts-v1')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'EVALUATION_ARCHIVED: AI evaluation has been archived.' using errcode='P0001'; end $$;

-- Keep existing caller/lease checks in the outer finalizers; only remove scoring.
create or replace function public.finalize_tailoring_materialization_v379(
  p_tailoring_job_id uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return public.finalize_tailoring_materialization_v19(p_tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
end $$;
revoke all on function public.finalize_tailoring_materialization_v379(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.finalize_tailoring_materialization_v379(uuid,uuid,text,text,text,bigint,text) to authenticated;

create or replace function public.enforce_application_match()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare gate jsonb; old_family uuid; new_family uuid;
begin
  if tg_op='UPDATE' then
    select coalesce(parent_resume_id,id) into old_family from public.resumes where id=old.resume_id;
    select coalesce(parent_resume_id,id) into new_family from public.resumes where id=new.resume_id;
    if old.job_description_id=new.job_description_id and old_family=new_family then
      new.matching_mode:=old.matching_mode;
      new.match_assessment_id:=old.match_assessment_id;
      new.match_score:=old.match_score; new.match_threshold:=old.match_threshold;
      return new;
    end if;
  end if;
  if coalesce(new.matching_mode,'CATEGORY') <> 'CATEGORY' then
    raise exception 'EVALUATION_ARCHIVED: Use category/subcategory matching.' using errcode='P0001';
  end if;
  perform public.assert_application_manager();
  perform 1 from public.job_descriptions where id=new.job_description_id for update;
  perform 1 from public.resumes where id=new.resume_id for share;
  gate:=public.application_category_eligibility_v377(new.job_description_id,new.resume_id);
  if not (gate->>'eligible')::boolean then
    raise exception '%: %',gate->>'exclusionCode',gate->>'exclusionReason' using errcode='P0001';
  end if;
  new.matching_mode:='CATEGORY';
  new.match_assessment_id:=null; new.match_score:=null; new.match_threshold:=null;
  return new;
end $$;

notify pgrst,'reload schema';
