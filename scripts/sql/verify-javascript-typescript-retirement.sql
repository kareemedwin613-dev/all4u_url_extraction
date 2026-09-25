-- Read-only deployment verification. Assignment counts must be zero; both guards true.
select c.active,
  (select count(*) from job_description_subcategories where subcategory_id=c.id) as jd_tag_assignments,
  (select count(*) from resume_tech_stacks where subcategory_id=c.id) as resume_tag_assignments,
  (select count(*) from job_descriptions where subcategory_id=c.id) as legacy_jd_assignments,
  (select count(*) from resumes where subcategory_id=c.id) as legacy_resume_assignments,
  (select count(*) from retired_taxonomy_assignments where category_id=c.id) as recovery_records,
  (select count(*) from retired_taxonomy_assignments where category_id=c.id and source_table='job_descriptions') as affected_jds,
  (select count(*) from job_descriptions j where j.subcategory_match_required and j.subcategory_id is null) as jds_needing_another_subtype,
  (select strpos(prosrc,'j.subcategory_id is null and not j.subcategory_match_required')>0 from pg_proc
    where oid='public.application_category_candidate_v377(uuid,uuid)'::regprocedure) as category_retirement_guard,
  (select strpos(prosrc,'j.id=$3 and j.subcategory_match_required')>0 from pg_proc
    where oid='public.resume_matches_job_for_bulk(uuid,uuid,uuid)'::regprocedure) as bulk_retirement_guard
from categories c where c.slug='javascript-typescript-engineering';
