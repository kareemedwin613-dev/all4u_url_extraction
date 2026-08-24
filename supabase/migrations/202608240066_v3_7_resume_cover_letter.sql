-- Default cover letter file metadata on ORIGINAL resumes + private cover-letters bucket.

alter table public.resumes
  add column if not exists cover_letter_storage_bucket text,
  add column if not exists cover_letter_storage_path text,
  add column if not exists cover_letter_original_filename text,
  add column if not exists cover_letter_mime_type text,
  add column if not exists cover_letter_file_size_bytes integer,
  add column if not exists cover_letter_file_sha256 text;

alter table public.resumes drop constraint if exists resumes_cover_letter_metadata_check;
alter table public.resumes add constraint resumes_cover_letter_metadata_check check (
  (
    cover_letter_storage_bucket is null
    and cover_letter_storage_path is null
    and cover_letter_original_filename is null
    and cover_letter_mime_type is null
    and cover_letter_file_size_bytes is null
    and cover_letter_file_sha256 is null
  )
  or (
    cover_letter_storage_bucket = 'cover-letters'
    and cover_letter_storage_path is not null
    and cover_letter_storage_path like user_id::text || '/%'
    and char_length(cover_letter_original_filename) between 1 and 255
    and cover_letter_mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    )
    and cover_letter_file_size_bytes between 1 and 5242880
    and cover_letter_file_sha256 ~ '^[0-9a-f]{64}$'
  )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'cover-letters',
  'cover-letters',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

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

drop policy if exists "managers write cover letters" on storage.objects;
create policy "managers write cover letters" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'cover-letters'
  and (select public.is_active_user(auth.uid()))
  and (select public.application_actor_can_manage())
);

drop policy if exists "managers update cover letters" on storage.objects;
create policy "managers update cover letters" on storage.objects
for update to authenticated
using (
  bucket_id = 'cover-letters'
  and (select public.is_active_user(auth.uid()))
  and (select public.application_actor_can_manage())
)
with check (
  bucket_id = 'cover-letters'
  and (select public.is_active_user(auth.uid()))
  and (select public.application_actor_can_manage())
);

drop policy if exists "managers delete cover letters" on storage.objects;
create policy "managers delete cover letters" on storage.objects
for delete to authenticated
using (
  bucket_id = 'cover-letters'
  and (select public.is_active_user(auth.uid()))
  and (select public.application_actor_can_manage())
);

comment on column public.resumes.cover_letter_storage_path is
  'Optional default cover letter object path in the private cover-letters bucket (ORIGINAL resumes only).';

-- Managers may attach cover letters to any ORIGINAL Resume they can manage (not only own uploads).
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

create or replace function public.clear_resume_cover_letter_v37(p_resume_id uuid)
returns jsonb
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
    raise exception 'RESUME_TYPE_INVALID: Cover letters can only be managed on original Resumes.' using errcode = '22023';
  end if;
  if v_current.cover_letter_storage_path is null then
    return jsonb_build_object('resume', to_jsonb(v_current), 'previousPath', null, 'previousBucket', null);
  end if;
  update public.resumes set
    cover_letter_storage_bucket = null,
    cover_letter_storage_path = null,
    cover_letter_original_filename = null,
    cover_letter_mime_type = null,
    cover_letter_file_size_bytes = null,
    cover_letter_file_sha256 = null,
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
revoke all on function public.clear_resume_cover_letter_v37(uuid) from public, anon;
grant execute on function public.set_resume_cover_letter_v37(uuid,text,text,text,integer,text) to authenticated;
grant execute on function public.clear_resume_cover_letter_v37(uuid) to authenticated;
