-- Read-only deployment verification. Assignment counts and broad matches must be zero.
select c.active,
  (select count(*) from job_description_subcategories where subcategory_id=c.id) as jd_tag_assignments,
  (select count(*) from resume_tech_stacks where subcategory_id=c.id) as resume_tag_assignments,
  (select count(*) from job_descriptions where subcategory_id=c.id) as legacy_jd_assignments,
  (select count(*) from resumes where subcategory_id=c.id) as legacy_resume_assignments,
  (select count(*) from retired_taxonomy_assignments where category_id=c.id) as recovery_records,
  (select count(*) from retired_taxonomy_assignments where category_id=c.id and source_table='job_descriptions') as affected_jds,
  (select count(*) from job_descriptions j where j.subcategory_match_required and j.subcategory_id is null) as jds_needing_another_subtype,
  (select count(*) from job_descriptions j join categories p on p.id=j.category_id and p.slug='software-engineering'
    cross join resumes r where j.subcategory_match_required and j.subcategory_id is null
      and r.status='ACTIVE' and r.resume_type='ORIGINAL'
      and (application_category_candidate_v377(j.id,r.id) or resume_matches_job_for_bulk(r.id,j.category_id,j.id))) as unwanted_primary_only_matches
from categories c where c.slug='javascript-typescript-engineering';
