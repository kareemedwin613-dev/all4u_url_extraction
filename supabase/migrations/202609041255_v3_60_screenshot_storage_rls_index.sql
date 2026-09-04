-- v3.60: Make application-screenshot Storage RLS index-friendly.
-- Insert/delete policies previously compared applications.id::text to the
-- folder name, which blocked UUID index use and could contribute to Storage
-- DatabaseTimeout under pool pressure.

drop policy if exists "assigned applier or manager insert application screenshots" on storage.objects;
create policy "assigned applier or manager insert application screenshots" on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-screenshots'
  and (select public.is_active_user(auth.uid()))
  and (
    (select public.application_actor_can_manage())
    or (
      (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.applications a
        where a.id = ((storage.foldername(name))[1])::uuid
          and a.assigned_to = (select auth.uid())
      )
    )
  )
);

drop policy if exists "assigned applier or manager delete application screenshots" on storage.objects;
create policy "assigned applier or manager delete application screenshots" on storage.objects for delete to authenticated
using (
  bucket_id = 'application-screenshots'
  and (select public.is_active_user(auth.uid()))
  and (
    (select public.application_actor_can_manage())
    or (
      (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.applications a
        where a.id = ((storage.foldername(name))[1])::uuid
          and a.assigned_to = (select auth.uid())
      )
    )
  )
);
