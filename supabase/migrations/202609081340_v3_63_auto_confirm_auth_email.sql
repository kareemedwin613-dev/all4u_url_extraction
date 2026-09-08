-- v3.63: Drop email-confirmation as a sign-in gate.
-- Registration still waits for an administrator to assign a role. Auth emails
-- are auto-confirmed so Appliers can sign in after approval without a link.

create or replace function public.confirm_auth_user_email_v363(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    return;
  end if;
  update auth.users
  set
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now(),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email_verified', true)
  where id = p_user_id
    and (
      email_confirmed_at is null
      or coalesce(raw_user_meta_data->>'email_verified', 'false') <> 'true'
    );
end;
$$;

create or replace function public.auto_confirm_auth_user_email_v363()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.confirm_auth_user_email_v363(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm_v363 on auth.users;
create trigger on_auth_user_created_auto_confirm_v363
after insert on auth.users
for each row
execute function public.auto_confirm_auth_user_email_v363();

-- Confirm every existing Auth user so current Appliers can sign in immediately.
select public.confirm_auth_user_email_v363(id) from auth.users where email_confirmed_at is null;

create or replace function public.admin_assign_role(p_user_id uuid, p_role_code text)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid;
  v_role_id uuid;
  v_role_code text := upper(trim(coalesce(p_role_code, '')));
  v_roles text[];
begin
  v_caller := public.assert_active_admin();
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select id into v_role_id from public.roles where code = v_role_code and active;
  if not found then raise exception 'ROLE_NOT_FOUND' using errcode = '22023'; end if;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (p_user_id, v_role_id, v_caller)
  on conflict (user_id, role_id) do nothing;
  perform public.confirm_auth_user_email_v363(p_user_id);
  select coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[])
  into v_roles
  from public.user_roles as assignments join public.roles as roles on roles.id = assignments.role_id
  where assignments.user_id = p_user_id;
  return v_roles;
end;
$$;

revoke all on function public.confirm_auth_user_email_v363(uuid) from public, anon, authenticated;
revoke all on function public.auto_confirm_auth_user_email_v363() from public, anon, authenticated;
revoke all on function public.admin_assign_role(uuid, text) from public, anon;
grant execute on function public.admin_assign_role(uuid, text) to authenticated;
