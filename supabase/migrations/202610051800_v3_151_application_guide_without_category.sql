-- Application Guide entries no longer use a category or an answer type.
-- Example text stays optional.

drop function if exists public.save_application_guide_v3149(uuid, text, text, text, text, text, text, text);
drop function if exists public.list_application_guide_v3149();
drop function if exists public.application_guide_json(public.application_guide_entries);

alter table public.application_guide_entries drop column if exists answer_type;
alter table public.application_guide_entries drop column if exists category;

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
        status = v_status,
        version = case
          when v_status = 'PUBLISHED' and (
            v_current.status <> 'PUBLISHED'
            or v_current.question is distinct from v_question
            or v_current.meaning is distinct from v_meaning
            or v_current.how_to_answer is distinct from v_how
            or v_current.example_answer is distinct from v_example
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
      question, meaning, how_to_answer, example_answer, status,
      version, sort_order, created_by, approved_by, published_at
    )
    values (
      v_question, v_meaning, v_how, v_example, v_status,
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

revoke all on function public.application_guide_json(public.application_guide_entries) from public, anon, authenticated;
revoke all on function public.list_application_guide_v3149() from public, anon;
revoke all on function public.save_application_guide_v3149(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.list_application_guide_v3149() to authenticated;
grant execute on function public.save_application_guide_v3149(uuid, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
