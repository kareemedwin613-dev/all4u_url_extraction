-- Privacy-safe aggregate Autofill quality reporting. No field values, Resume
-- content, question text, email, phone, or page URL is returned.
create or replace function public.get_autofill_quality_report_v098(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_days integer:=greatest(1,least(coalesce(p_days,30),90));v_result jsonb;
begin
 if v_actor is null or not public.is_active_user(v_actor) or not (public.has_role('APPLYING_MANAGER',v_actor) or public.has_role('ADMIN',v_actor)) then raise exception 'AUTOFILL_REPORT_ACCESS_DENIED: Applying Manager or Admin access is required.' using errcode='42501';end if;
 select jsonb_build_object('days',v_days,'generatedAt',now(),'items',coalesce(jsonb_agg(to_jsonb(x) order by x.sessions desc,x.adapter_id,x.target_domain),'[]'::jsonb)) into v_result from(
  select coalesce(s.adapter_id,'unknown') adapter_id,coalesce(s.adapter_version,'unknown') adapter_version,coalesce(s.target_domain,'unknown') target_domain,
   count(*)::integer sessions,coalesce(sum(s.detected_count),0)::integer detected,coalesce(sum(s.succeeded_count),0)::integer verified,
   coalesce(sum(s.failed_count),0)::integer failed,coalesce(sum(s.unresolved_count),0)::integer unresolved,
   case when coalesce(sum(s.selected_count),0)=0 then 0 else round(100.0*sum(s.succeeded_count)/sum(s.selected_count),1) end verification_rate
  from public.application_extension_sessions s where s.action='AUTOFILL' and s.created_at>=now()-make_interval(days=>v_days)
  group by s.adapter_id,s.adapter_version,s.target_domain
 )x;
 return v_result;
end$$;
revoke all on function public.get_autofill_quality_report_v098(integer) from public,anon;
grant execute on function public.get_autofill_quality_report_v098(integer) to authenticated;
