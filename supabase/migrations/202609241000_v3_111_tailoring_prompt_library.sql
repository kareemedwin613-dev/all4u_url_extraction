-- Configurable tailoring, milestone 2. Not connected to job creation/workers yet.
create table public.tailoring_prompt_definitions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('GENERIC','PRIMARY','SUBTYPE')),
  primary_category_id uuid references public.categories(id) on delete restrict,
  subcategory_id uuid references public.categories(id) on delete restrict,
  draft_name text not null check (char_length(btrim(draft_name)) between 1 and 120),
  draft_body text not null check (char_length(draft_body) between 1 and 20000 and btrim(draft_body) <> ''),
  draft_priority integer not null default 0 check (draft_priority between 0 and 100000),
  draft_pending boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  published_version integer,
  published_priority integer,
  archived boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='GENERIC' and primary_category_id is null and subcategory_id is null)
    or (scope='PRIMARY' and primary_category_id is not null and subcategory_id is null)
    or (scope='SUBTYPE' and primary_category_id is not null and subcategory_id is not null)),
  check ((published_version is null) = (published_priority is null))
);

create table public.tailoring_prompt_versions (
  prompt_id uuid not null references public.tailoring_prompt_definitions(id) on delete restrict,
  version integer not null check (version > 0),
  name text not null,
  body text not null,
  priority integer not null,
  contract_version text not null default '1',
  published_by uuid,
  published_at timestamptz not null default now(),
  restored_from_version integer,
  primary key (prompt_id,version),
  foreign key (prompt_id,restored_from_version) references public.tailoring_prompt_versions(prompt_id,version)
);
alter table public.tailoring_prompt_definitions add constraint tailoring_prompt_published_version_fk
  foreign key (id,published_version) references public.tailoring_prompt_versions(prompt_id,version);

-- Indexes are the final concurrency guard even for transactions using old snapshots.
create unique index tailoring_prompt_one_generic on public.tailoring_prompt_definitions(scope)
  where scope='GENERIC' and not archived and published_version is not null;
create unique index tailoring_prompt_one_primary on public.tailoring_prompt_definitions(primary_category_id)
  where scope='PRIMARY' and not archived and published_version is not null;
create unique index tailoring_prompt_one_subtype on public.tailoring_prompt_definitions(primary_category_id,subcategory_id)
  where scope='SUBTYPE' and not archived and published_version is not null;
create unique index tailoring_prompt_subtype_priority on public.tailoring_prompt_definitions(primary_category_id,published_priority)
  where scope='SUBTYPE' and not archived and published_version is not null;

create table public.tailoring_prompt_events (
  id bigint generated always as identity primary key,
  prompt_id uuid not null references public.tailoring_prompt_definitions(id) on delete restrict,
  action text not null check (action in ('SEED','CREATE','SAVE','PUBLISH','ARCHIVE','RESTORE')),
  revision integer not null,
  version integer,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create function public.tailoring_prompt_manager_v1() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and coalesce(public.is_active_user(auth.uid()),false)
    and coalesce(public.has_any_role(array['ADMIN','APPLYING_MANAGER'],auth.uid()),false)
$$;

create function public.tailoring_prompt_immutable_v1() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'PROMPT_IMMUTABLE: Published versions and events cannot be changed or deleted.' using errcode='P0001';
end;
$$;
create trigger tailoring_prompt_versions_immutable before update or delete on public.tailoring_prompt_versions
  for each row execute function public.tailoring_prompt_immutable_v1();
create trigger tailoring_prompt_events_immutable before update or delete on public.tailoring_prompt_events
  for each row execute function public.tailoring_prompt_immutable_v1();

alter table public.tailoring_prompt_definitions enable row level security;
alter table public.tailoring_prompt_versions enable row level security;
alter table public.tailoring_prompt_events enable row level security;
revoke all on public.tailoring_prompt_definitions,public.tailoring_prompt_versions,public.tailoring_prompt_events from public,anon,authenticated;
grant select on public.tailoring_prompt_definitions,public.tailoring_prompt_versions,public.tailoring_prompt_events to authenticated;
create policy prompt_definitions_read on public.tailoring_prompt_definitions for select to authenticated using(public.tailoring_prompt_manager_v1());
create policy prompt_versions_read on public.tailoring_prompt_versions for select to authenticated using(public.tailoring_prompt_manager_v1());
create policy prompt_events_read on public.tailoring_prompt_events for select to authenticated using(public.tailoring_prompt_manager_v1());

create function public.read_tailoring_prompts_v1(p_prompt_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not public.tailoring_prompt_manager_v1() then
    raise exception 'PROMPT_FORBIDDEN: An active manager or admin is required.' using errcode='42501';
  end if;
  if p_prompt_id is null then
    select coalesce(jsonb_agg((to_jsonb(d)-'draft_body') || jsonb_build_object('published_name',v.name)
      order by d.scope,d.primary_category_id,d.subcategory_id,d.created_at,d.id),'[]'::jsonb)
      into result from public.tailoring_prompt_definitions d
      left join public.tailoring_prompt_versions v on v.prompt_id=d.id and v.version=d.published_version;
    return result;
  end if;
  select to_jsonb(d) || jsonb_build_object(
    'versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.version desc) from public.tailoring_prompt_versions v where v.prompt_id=d.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from public.tailoring_prompt_events e where e.prompt_id=d.id),'[]'::jsonb)
  ) into result from public.tailoring_prompt_definitions d where d.id=p_prompt_id;
  if result is null then raise exception 'PROMPT_NOT_FOUND: Prompt not found.'; end if;
  return result;
end;
$$;

create function public.manage_tailoring_prompt_v1(
  p_action text, p_prompt_id uuid default null, p_expected_revision integer default null,
  p_name text default null, p_body text default null, p_priority integer default 0,
  p_scope text default null, p_primary_category_id uuid default null,
  p_subcategory_id uuid default null, p_version integer default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.tailoring_prompt_definitions; v public.tailoring_prompt_versions; next_version integer;
begin
  if not public.tailoring_prompt_manager_v1() then
    raise exception 'PROMPT_FORBIDDEN: An active manager or admin is required.' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('CREATE','SAVE','PUBLISH','ARCHIVE','RESTORE') then
    raise exception 'PROMPT_INVALID: Unsupported action.';
  end if;
  -- Serialize only small configuration writes, never tailoring jobs or preview reads.
  perform pg_advisory_xact_lock(241000,111);
  if p_action='CREATE' then
    d.id:=gen_random_uuid(); d.scope:=p_scope;
    d.primary_category_id:=p_primary_category_id; d.subcategory_id:=p_subcategory_id;
    if p_scope is null or not (
      (p_scope='GENERIC' and p_primary_category_id is null and p_subcategory_id is null)
      or (p_scope='PRIMARY' and p_primary_category_id is not null and p_subcategory_id is null)
      or (p_scope='SUBTYPE' and p_primary_category_id is not null and p_subcategory_id is not null)
    ) then raise exception 'PROMPT_INVALID: Invalid prompt scope.'; end if;
  else
    select * into d from public.tailoring_prompt_definitions where id=p_prompt_id for update;
    if not found then raise exception 'PROMPT_NOT_FOUND: Prompt not found.'; end if;
    if p_expected_revision is distinct from d.revision then
      raise exception 'PROMPT_STALE: The prompt changed. Reload before saving.';
    end if;
  end if;
  if p_action in ('CREATE','SAVE','PUBLISH','RESTORE') then
    if d.scope<>'GENERIC' and not exists(select 1 from public.categories
      where id=d.primary_category_id and active and parent_id is null) then
      raise exception 'PROMPT_INVALID: Select an active primary category.';
    end if;
    if d.scope='SUBTYPE' and not exists(select 1 from public.categories
      where id=d.subcategory_id and active and parent_id=d.primary_category_id) then
      raise exception 'PROMPT_INVALID: Subtype must belong to the active primary category.';
    end if;
  end if;
  if p_action in ('CREATE','SAVE') then
    if p_name is null or char_length(btrim(p_name)) not between 1 and 120
      or p_body is null or char_length(p_body) not between 1 and 20000 or btrim(p_body)=''
      or p_priority is null or p_priority not between 0 and 100000 then
      raise exception 'PROMPT_INVALID: Name, instructions, and priority are required and must be within limits.';
    end if;
    if p_action='CREATE' then
      insert into public.tailoring_prompt_definitions(id,scope,primary_category_id,subcategory_id,draft_name,draft_body,draft_priority,created_by,updated_by)
        values(d.id,d.scope,d.primary_category_id,d.subcategory_id,btrim(p_name),p_body,p_priority,auth.uid(),auth.uid()) returning * into d;
    else
      update public.tailoring_prompt_definitions set draft_name=btrim(p_name),draft_body=p_body,draft_priority=p_priority,
        draft_pending=true,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
    end if;
  elsif p_action='ARCHIVE' then
    if d.scope='GENERIC' and d.published_version is not null and not d.archived then
      raise exception 'PROMPT_FALLBACK_REQUIRED: The published Generic fallback cannot be archived. Publish a new version instead.';
    end if;
    update public.tailoring_prompt_definitions set archived=true,revision=revision+1,updated_by=auth.uid(),updated_at=now()
      where id=d.id returning * into d;
  else
    if p_action='RESTORE' then
      select * into v from public.tailoring_prompt_versions where prompt_id=d.id and version=p_version;
      if not found then raise exception 'PROMPT_VERSION_NOT_FOUND: Published version not found for this prompt.'; end if;
      d.draft_name:=v.name; d.draft_body:=v.body; d.draft_priority:=v.priority;
    elsif not d.draft_pending and not d.archived then
      raise exception 'PROMPT_CONFLICT: There is no unpublished draft.';
    end if;
    select coalesce(max(version),0)+1 into next_version from public.tailoring_prompt_versions where prompt_id=d.id;
    insert into public.tailoring_prompt_versions(prompt_id,version,name,body,priority,published_by,restored_from_version)
      values(d.id,next_version,d.draft_name,d.draft_body,d.draft_priority,auth.uid(),case when p_action='RESTORE' then p_version end);
    update public.tailoring_prompt_definitions set published_version=next_version,published_priority=d.draft_priority,
      draft_name=d.draft_name,draft_body=d.draft_body,draft_priority=d.draft_priority,draft_pending=false,archived=false,
      revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
  end if;
  insert into public.tailoring_prompt_events(prompt_id,action,revision,version,actor_id)
    values(d.id,p_action,d.revision,d.published_version,auth.uid());
  return public.read_tailoring_prompts_v1(d.id);
exception when unique_violation then
  raise exception 'PROMPT_CONFLICT: Another published prompt has this scope or subtype priority. Archive it or choose a different priority.';
end;
$$;

-- Internal selector is not executable by clients. Milestone 4 can call it inside
-- authorized job-creation RPCs; only the manager-only preview is exposed now.
create function public.select_tailoring_prompt_v1(p_job_description_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j public.job_descriptions; subtypes uuid[]; result jsonb;
begin
  select * into j from public.job_descriptions where id=p_job_description_id;
  if not found then raise exception 'PROMPT_JOB_NOT_FOUND: Job description not found.'; end if;
  subtypes:=public.job_description_subcategory_ids(j.id);
  select jsonb_build_object('promptId',d.id,'name',v.name,'version',v.version,'instructions',v.body,
    'contractVersion',v.contract_version,'scope',d.scope,'primaryCategoryId',d.primary_category_id,
    'subcategoryId',d.subcategory_id,'priority',v.priority,'jobDescriptionId',j.id,
    'reason',case d.scope when 'SUBTYPE' then 'Highest-priority published matching subtype.'
      when 'PRIMARY' then 'No published subtype match; using primary-category default.'
      else 'No published category match; using Generic.' end)
    into result from public.tailoring_prompt_definitions d
    join public.tailoring_prompt_versions v on v.prompt_id=d.id and v.version=d.published_version
    left join public.categories pc on pc.id=d.primary_category_id
    left join public.categories sc on sc.id=d.subcategory_id
    where not d.archived and (d.scope='GENERIC' or (
      d.primary_category_id=j.category_id and pc.active and pc.parent_id is null
      and (d.scope='PRIMARY' or (sc.active and sc.parent_id=pc.id and d.subcategory_id=any(subtypes)))
    ))
    order by case d.scope when 'SUBTYPE' then 2 when 'PRIMARY' then 1 else 0 end desc,v.priority desc,d.id
    limit 1;
  if result is null then raise exception 'PROMPT_FALLBACK_REQUIRED: No published Generic fallback is configured.'; end if;
  return result;
end;
$$;
create function public.preview_tailoring_prompt_v1(p_job_description_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.tailoring_prompt_manager_v1() then
    raise exception 'PROMPT_FORBIDDEN: An active manager or admin is required.' using errcode='42501';
  end if;
  return public.select_tailoring_prompt_v1(p_job_description_id);
end;
$$;

revoke all on function public.tailoring_prompt_manager_v1(),public.tailoring_prompt_immutable_v1(),
  public.read_tailoring_prompts_v1(uuid),public.manage_tailoring_prompt_v1(text,uuid,integer,text,text,integer,text,uuid,uuid,integer),
  public.select_tailoring_prompt_v1(uuid),public.preview_tailoring_prompt_v1(uuid) from public,anon,authenticated;
grant execute on function public.tailoring_prompt_manager_v1(),public.read_tailoring_prompts_v1(uuid),
  public.manage_tailoring_prompt_v1(text,uuid,integer,text,text,integer,text,uuid,uuid,integer),public.preview_tailoring_prompt_v1(uuid) to authenticated;

-- Seed body is checked against apps/tailoring-worker/src/prompt-template.ts by tests.
do $seed$
declare prompt_id uuid:=gen_random_uuid(); baseline text:=$body$1. Silently inventory distinct skills, responsibilities, and keywords from the full JD and candidate skill list.
2. Rewrite the summary and bullets from scratch around realistic JD-aligned projects. Maximize natural coverage of exact JD keywords throughout the Resume; avoid stuffing and repetition.
3. Follow ROLE_TARGETS_JSON exactly. For each sourceExperienceId, reconstruct the specified number of projects and return exactly the specified number of bullets.
4. Start bullets with "- " and a strong action verb. Avoid repeated opening verbs. Include situation, technical design, collaboration, quantified impact, and outcome where useful.
5. Return at most 24 additional role-relevant technologies that are fundamental to the reconstructed projects but absent from jobDescription.skills and sourceResume.skills. Preserve exact spelling, deduplicate case-insensitively, and exclude company names, duties, and generic prose. The worker adds and groups all supplied JD and candidate skills deterministically.$body$;
begin
  insert into public.tailoring_prompt_definitions(id,scope,draft_name,draft_body,draft_pending)
    values(prompt_id,'GENERIC','Generic tailoring',baseline,false);
  insert into public.tailoring_prompt_versions(prompt_id,version,name,body,priority)
    values(prompt_id,1,'Generic tailoring',baseline,0);
  update public.tailoring_prompt_definitions set published_version=1,published_priority=0 where id=prompt_id;
  insert into public.tailoring_prompt_events(prompt_id,action,revision,version) values(prompt_id,'SEED',1,1);
end;
$seed$;
