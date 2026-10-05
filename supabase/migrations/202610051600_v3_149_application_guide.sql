-- Application Guide: published answers appliers can read, drafts only an Admin can see or change.

create table if not exists public.application_guide_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 1 and 300),
  meaning text not null check (char_length(btrim(meaning)) between 1 and 2000),
  how_to_answer text not null check (char_length(btrim(how_to_answer)) between 1 and 4000),
  example_answer text not null default '' check (char_length(example_answer) <= 1000),
  answer_type text not null check (answer_type in ('GENERAL_GUIDANCE', 'CANDIDATE_INFORMATION', 'CANDIDATE_DECISION')),
  category text not null check (category in ('PERSONAL_DETAILS', 'WORK_EXPERIENCE', 'CONSENT')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  version integer not null default 1 check (version >= 1),
  sort_order integer not null default 0,
  created_by uuid,
  approved_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists application_guide_entries_status_sort_idx
  on public.application_guide_entries (status, sort_order, question);

alter table public.application_guide_entries enable row level security;
alter table public.application_guide_entries replica identity full;

revoke all on table public.application_guide_entries from public, anon, authenticated;
grant select on table public.application_guide_entries to authenticated;

drop policy if exists application_guide_entries_read on public.application_guide_entries;
create policy application_guide_entries_read
  on public.application_guide_entries
  for select
  to authenticated
  using (
    public.is_active_user(auth.uid())
    and public.has_any_role(array['APPLIER', 'APPLYING_MANAGER', 'ADMIN'])
    and (
      status = 'PUBLISHED'
      or public.has_role('ADMIN', auth.uid())
    )
  );

comment on table public.application_guide_entries is
  'Reusable answers for job-application questions. Appliers read published rows. Admins keep drafts and publish updates.';

create or replace function public.application_guide_reader()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(auth.uid())
    and public.has_any_role(array['APPLIER', 'APPLYING_MANAGER', 'ADMIN']);
$$;

create or replace function public.application_guide_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(auth.uid())
    and public.has_role('ADMIN', auth.uid());
$$;

create or replace function public.application_guide_json(p_row public.application_guide_entries)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select nullif(btrim(full_name), '') into v_name
  from public.profiles
  where id = p_row.approved_by;
  return jsonb_build_object(
    'id', p_row.id,
    'question', p_row.question,
    'meaning', p_row.meaning,
    'howToAnswer', p_row.how_to_answer,
    'exampleAnswer', p_row.example_answer,
    'answerType', p_row.answer_type,
    'category', p_row.category,
    'status', p_row.status,
    'version', p_row.version,
    'sortOrder', p_row.sort_order,
    'approvedByName', v_name,
    'publishedAt', p_row.published_at,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at
  );
end;
$$;

create or replace function public.list_application_guide_v3149()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin boolean := public.application_guide_admin();
  v_result jsonb;
begin
  if not public.application_guide_reader() then
    raise exception 'FORBIDDEN: You cannot view the Application Guide.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(public.application_guide_json(entry) order by
    case when entry.status = 'DRAFT' then 0 else 1 end,
    entry.sort_order,
    entry.question
  ), '[]'::jsonb)
  into v_result
  from public.application_guide_entries entry
  where entry.status = 'PUBLISHED' or v_admin;
  return v_result;
end;
$$;

create or replace function public.save_application_guide_v3149(
  p_id uuid,
  p_question text,
  p_meaning text,
  p_how_to_answer text,
  p_example text,
  p_answer_type text,
  p_category text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_question text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_meaning text := btrim(coalesce(p_meaning, ''));
  v_how text := btrim(coalesce(p_how_to_answer, ''));
  v_example text := btrim(coalesce(p_example, ''));
  v_type text := upper(btrim(coalesce(p_answer_type, '')));
  v_category text := upper(btrim(coalesce(p_category, '')));
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_current public.application_guide_entries;
  v_saved public.application_guide_entries;
begin
  if not public.application_guide_admin() then
    raise exception 'FORBIDDEN: Only an Admin can change the Application Guide.' using errcode = '42501';
  end if;
  if char_length(v_question) < 1 or char_length(v_question) > 300 then
    raise exception 'VALIDATION_ERROR: Enter the question in 1 to 300 characters.' using errcode = '22023';
  end if;
  if char_length(v_meaning) < 1 or char_length(v_meaning) > 2000 then
    raise exception 'VALIDATION_ERROR: Enter what the question means in 1 to 2000 characters.' using errcode = '22023';
  end if;
  if char_length(v_how) < 1 or char_length(v_how) > 4000 then
    raise exception 'VALIDATION_ERROR: Enter how to answer in 1 to 4000 characters.' using errcode = '22023';
  end if;
  if char_length(v_example) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the example under 1000 characters.' using errcode = '22023';
  end if;
  if v_type not in ('GENERAL_GUIDANCE', 'CANDIDATE_INFORMATION', 'CANDIDATE_DECISION') then
    raise exception 'VALIDATION_ERROR: Choose an answer type.' using errcode = '22023';
  end if;
  if v_category not in ('PERSONAL_DETAILS', 'WORK_EXPERIENCE', 'CONSENT') then
    raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023';
  end if;
  if v_status not in ('DRAFT', 'PUBLISHED') then
    raise exception 'VALIDATION_ERROR: Save the entry as a draft or publish it.' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_current from public.application_guide_entries where id = p_id;
    if v_current.id is null then
      raise exception 'GUIDE_ENTRY_NOT_FOUND: That guide entry was not found.' using errcode = 'P0002';
    end if;
    update public.application_guide_entries
    set question = v_question,
        meaning = v_meaning,
        how_to_answer = v_how,
        example_answer = v_example,
        answer_type = v_type,
        category = v_category,
        status = v_status,
        version = case
          when v_status = 'PUBLISHED' and (
            v_current.status <> 'PUBLISHED'
            or v_current.question is distinct from v_question
            or v_current.meaning is distinct from v_meaning
            or v_current.how_to_answer is distinct from v_how
            or v_current.example_answer is distinct from v_example
            or v_current.answer_type is distinct from v_type
            or v_current.category is distinct from v_category
          ) then v_current.version + 1
          else v_current.version
        end,
        approved_by = case when v_status = 'PUBLISHED' then auth.uid() else v_current.approved_by end,
        published_at = case
          when v_status = 'PUBLISHED' then coalesce(v_current.published_at, clock_timestamp())
          else v_current.published_at
        end,
        updated_at = clock_timestamp()
    where id = p_id
    returning * into v_saved;
  else
    insert into public.application_guide_entries (
      question, meaning, how_to_answer, example_answer, answer_type, category, status,
      version, sort_order, created_by, approved_by, published_at
    )
    values (
      v_question, v_meaning, v_how, v_example, v_type, v_category, v_status,
      1,
      coalesce((select max(sort_order) + 10 from public.application_guide_entries), 10),
      auth.uid(),
      case when v_status = 'PUBLISHED' then auth.uid() end,
      case when v_status = 'PUBLISHED' then clock_timestamp() end
    )
    returning * into v_saved;
  end if;

  return public.application_guide_json(v_saved);
end;
$$;

create or replace function public.delete_application_guide_v3149(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted uuid;
begin
  if not public.application_guide_admin() then
    raise exception 'FORBIDDEN: Only an Admin can change the Application Guide.' using errcode = '42501';
  end if;
  delete from public.application_guide_entries where id = p_id returning id into v_deleted;
  if v_deleted is null then
    raise exception 'GUIDE_ENTRY_NOT_FOUND: That guide entry was not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_deleted);
end;
$$;

revoke all on function public.application_guide_reader() from public, anon, authenticated;
revoke all on function public.application_guide_admin() from public, anon, authenticated;
revoke all on function public.application_guide_json(public.application_guide_entries) from public, anon, authenticated;
revoke all on function public.list_application_guide_v3149() from public, anon;
revoke all on function public.save_application_guide_v3149(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.delete_application_guide_v3149(uuid) from public, anon;
grant execute on function public.list_application_guide_v3149() to authenticated;
grant execute on function public.save_application_guide_v3149(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.delete_application_guide_v3149(uuid) to authenticated;

insert into public.application_guide_entries (
  question, meaning, how_to_answer, example_answer, answer_type, category, status, version, sort_order, published_at
)
select
  'What goes in Home Address and Address Line 2?',
  'Home Address is the street number and street name. Address Line 2 is for an apartment, unit, or suite.',
  'Use the candidate''s confirmed address. Leave Line 2 blank if there is no unit. When separate city, state, and ZIP fields exist, enter those details there.',
  E'Home Address: 123 Example St\nAddress Line 2: Apt 4B',
  'GENERAL_GUIDANCE',
  'PERSONAL_DETAILS',
  'PUBLISHED',
  1,
  10,
  clock_timestamp()
where not exists (
  select 1 from public.application_guide_entries
  where question = 'What goes in Home Address and Address Line 2?'
);

insert into public.application_guide_entries (
  question, meaning, how_to_answer, example_answer, answer_type, category, status, version, sort_order, published_at
)
select
  'Does "Location" mean the company office or home address?',
  'Some forms ask for Location without saying whose address they want.',
  'If the field sits with the candidate''s contact details, use the candidate''s confirmed home city and state. If it sits with the job or work-site questions, use the office location printed on the posting. Do not invent a city.',
  'Candidate contact location: the city and state on the confirmed profile. Job work site: the city named on the posting.',
  'GENERAL_GUIDANCE',
  'PERSONAL_DETAILS',
  'PUBLISHED',
  1,
  20,
  clock_timestamp()
where not exists (
  select 1 from public.application_guide_entries
  where question = 'Does "Location" mean the company office or home address?'
);

insert into public.application_guide_entries (
  question, meaning, how_to_answer, example_answer, answer_type, category, status, version, sort_order, published_at
)
select
  'Do you participate in outside employment or business activities?',
  'The employer is asking whether this candidate has another job, contract, or business.',
  'Use only what the candidate has confirmed. If they confirmed there is no outside work, answer No. If they confirmed outside work, answer Yes and add only the details they provided. Do not choose Yes or No for every profile.',
  'Leave this blank until the candidate confirms it.',
  'CANDIDATE_DECISION',
  'WORK_EXPERIENCE',
  'PUBLISHED',
  1,
  30,
  clock_timestamp()
where not exists (
  select 1 from public.application_guide_entries
  where question = 'Do you participate in outside employment or business activities?'
);

insert into public.application_guide_entries (
  question, meaning, how_to_answer, example_answer, answer_type, category, status, version, sort_order, published_at
)
select
  'Do you consent to AI evaluating your candidacy?',
  'The employer may use software to read or score the application.',
  'This is the candidate''s choice. Answer only after they confirm Yes or No. Do not use one consent answer for every profile.',
  'Leave this blank until the candidate confirms it.',
  'CANDIDATE_DECISION',
  'CONSENT',
  'PUBLISHED',
  1,
  40,
  clock_timestamp()
where not exists (
  select 1 from public.application_guide_entries
  where question = 'Do you consent to AI evaluating your candidacy?'
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'application_guide_entries'
    ) then
      alter publication supabase_realtime add table public.application_guide_entries;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
