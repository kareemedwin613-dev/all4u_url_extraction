-- Fix cover-letters SELECT RLS: managers must be able to read bucket objects
-- before Resume metadata links the path (required for Storage upsert on first upload).
-- Also enforce cover-letter paths stay under the Resume owner folder.

drop policy if exists "resume scoped read cover letters" on storage.objects;
create policy "resume scoped read cover letters" on storage.objects
for select to authenticated
using (
  bucket_id = 'cover-letters'
  and (select public.is_active_user(auth.uid()))
  and (
    (select public.application_actor_can_manage())
    or exists (
      select 1 from public.resumes r
      where r.cover_letter_storage_bucket = bucket_id
        and r.cover_letter_storage_path = name
        and public.resume_actor_can_view(r.id)
    )
  )
);

create or replace function public.set_resume_cover_letter_v37(
  p_resume_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes integer,
  p_file_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_current public.resumes;
  v_updated public.resumes;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage cover letters.' using errcode = '42501';
  end if;
  select * into v_current from public.resumes where id = p_resume_id for update;
  if not found then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode = 'P0001';
  end if;
  if v_current.resume_type <> 'ORIGINAL' then
    raise exception 'RESUME_TYPE_INVALID: Cover letters can only be attached to original Resumes.' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path not like v_current.user_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: Cover letter path must stay under the Resume owner folder.' using errcode = '22023';
  end if;
  update public.resumes set
    cover_letter_storage_bucket = 'cover-letters',
    cover_letter_storage_path = p_storage_path,
    cover_letter_original_filename = p_original_filename,
    cover_letter_mime_type = p_mime_type,
    cover_letter_file_size_bytes = p_file_size_bytes,
    cover_letter_file_sha256 = lower(p_file_sha256),
    updated_at = clock_timestamp()
  where id = p_resume_id
  returning * into v_updated;
  return jsonb_build_object(
    'resume', to_jsonb(v_updated),
    'previousPath', v_current.cover_letter_storage_path,
    'previousBucket', v_current.cover_letter_storage_bucket
  );
end;
$$;

revoke all on function public.set_resume_cover_letter_v37(uuid,text,text,text,integer,text) from public, anon;
grant execute on function public.set_resume_cover_letter_v37(uuid,text,text,text,integer,text) to authenticated;
