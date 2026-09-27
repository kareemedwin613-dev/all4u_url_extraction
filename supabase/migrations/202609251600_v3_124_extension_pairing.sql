-- Connect the Chrome extension from an already signed-in dashboard (device-authorization style).
-- The extension keeps a random secret and sends only its SHA-256 (the challenge) to the dashboard.
-- The signed-in user approves that challenge; the extension then redeems with the secret through
-- the API, which creates a separate Supabase session for it. Pairings are single use and expire
-- after 5 minutes. No policies: rows are reachable only through these functions.
create table public.extension_pairings (
  id uuid primary key,
  challenge text not null check (challenge ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  redeemed_at timestamptz
);
alter table public.extension_pairings enable row level security;
revoke all on public.extension_pairings from public,anon,authenticated;

-- Dashboard side: the caller approves the extension that shows the same confirmation code.
create function public.approve_extension_pairing_v124(p_pairing_id uuid,p_challenge text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid();v_roles text[];
begin
  if v_user is null or not coalesce(public.is_active_user(v_user),false) then
    raise exception 'EXTENSION_PAIRING_FORBIDDEN: Sign in with an active account to connect the extension.' using errcode='42501';
  end if;
  select coalesce(array_agg(r.code),'{}') into v_roles from public.user_roles ur join public.roles r on r.id=ur.role_id and r.active where ur.user_id=v_user;
  if cardinality(v_roles)=0 then
    raise exception 'EXTENSION_PAIRING_FORBIDDEN: An administrator must assign you a role before the extension can connect.' using errcode='42501';
  end if;
  if p_pairing_id is null or coalesce(p_challenge,'')!~'^[0-9a-f]{64}$' then
    raise exception 'EXTENSION_PAIRING_INVALID: This connection link is incomplete. Click Connect in the extension again.' using errcode='22023';
  end if;
  delete from public.extension_pairings where expires_at<now()-interval '1 day';
  insert into public.extension_pairings(id,challenge,user_id) values(p_pairing_id,p_challenge,v_user)
    on conflict (id) do nothing;
  if not found then
    raise exception 'EXTENSION_PAIRING_USED: This connection request was already approved. Click Connect in the extension again.' using errcode='P0001';
  end if;
  return jsonb_build_object('pairingId',p_pairing_id,'expiresAt',now()+interval '5 minutes');
end$$;
revoke all on function public.approve_extension_pairing_v124(uuid,text) from public,anon;
grant execute on function public.approve_extension_pairing_v124(uuid,text) to authenticated;

-- API side (anonymous client): proves possession of the secret and consumes the pairing once.
-- Returns PENDING until the dashboard approves; only APPROVED carries the user to sign in.
create function public.redeem_extension_pairing_v124(p_pairing_id uuid,p_secret text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_pairing public.extension_pairings;v_email text;
begin
  if p_pairing_id is null or char_length(coalesce(p_secret,'')) not between 32 and 128 then
    raise exception 'EXTENSION_PAIRING_INVALID: The connection request is invalid.' using errcode='22023';
  end if;
  select * into v_pairing from public.extension_pairings where id=p_pairing_id for update;
  if not found then return jsonb_build_object('state','PENDING'); end if;
  if v_pairing.challenge<>encode(digest(p_secret,'sha256'),'hex') then
    raise exception 'EXTENSION_PAIRING_INVALID: The connection request is invalid.' using errcode='22023';
  end if;
  if v_pairing.redeemed_at is not null then return jsonb_build_object('state','USED'); end if;
  if v_pairing.expires_at<=now() then return jsonb_build_object('state','EXPIRED'); end if;
  update public.extension_pairings set redeemed_at=now() where id=p_pairing_id;
  if not coalesce(public.is_active_user(v_pairing.user_id),false) then
    raise exception 'EXTENSION_PAIRING_FORBIDDEN: This account is inactive.' using errcode='42501';
  end if;
  select email into v_email from auth.users where id=v_pairing.user_id;
  if v_email is null then raise exception 'EXTENSION_PAIRING_FORBIDDEN: This account cannot sign in.' using errcode='42501'; end if;
  return jsonb_build_object('state','APPROVED','userId',v_pairing.user_id,'email',v_email);
end$$;
revoke all on function public.redeem_extension_pairing_v124(uuid,text) from public,authenticated;
grant execute on function public.redeem_extension_pairing_v124(uuid,text) to anon;
notify pgrst,'reload schema';
