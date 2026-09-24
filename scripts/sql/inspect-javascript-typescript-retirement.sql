-- Read-only preflight; no resume/JD content or personal data is returned.
select c.id,c.slug,c.name,c.active,
  (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='202609200000') as recent_recorded_migrations,
  (select count(*) from job_description_subcategories s where s.subcategory_id=c.id) as tagged_jds,
  (select count(*) from job_descriptions j where j.subcategory_id=c.id) as legacy_tagged_jds,
  (select count(distinct s.resume_id) from resume_tech_stacks s join resumes r on r.id=s.resume_id where s.subcategory_id=c.id and r.resume_type='ORIGINAL' and r.status='ACTIVE') as active_originals
from categories c where c.slug='javascript-typescript-engineering';
