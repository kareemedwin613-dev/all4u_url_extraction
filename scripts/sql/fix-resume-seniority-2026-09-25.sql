-- Correct original Resume seniority that overstated or omitted the level shown by the
-- candidate's own titles and years (reviewed 2026-09-25). The tailored headline caps at this
-- value, so an overstated level would allow a headline the Resume cannot support.
-- Each update applies only if the value is still the one reviewed; rerunning is harmless.
begin;
update public.resumes r set seniority=v.new_value,updated_at=clock_timestamp()
from (values
  (13,'EXECUTIVE','SENIOR'),     -- latest "Data Scientist", no lead titles
  (36,'EXECUTIVE','PRINCIPAL'),  -- "Staff Data Engineer"
  (45,'EXECUTIVE','SENIOR'),     -- "Senior Data Analyst"
  (12605,'EXECUTIVE','LEAD'),    -- "Lead Data Engineer"
  (11296,'LEAD','SENIOR'),       -- "Senior Data Engineer", never a lead title
  (12608,'LEAD','SENIOR'),
  (12625,'LEAD','SENIOR'),
  (12692,'PRINCIPAL','SENIOR'),  -- "Optimization Engineer", no senior titles
  (24653,'UNSPECIFIED','MID'),   -- "Software Engineer", 3.4 years
  (24747,'UNSPECIFIED','SENIOR') -- "Software Engineer", 8.7 years
) as v(resume_number,old_value,new_value)
where r.resume_number=v.resume_number and r.resume_type='ORIGINAL' and r.seniority=v.old_value;
select resume_number,seniority from public.resumes
where resume_type='ORIGINAL' and resume_number in (13,36,45,12605,11296,12608,12625,12692,24653,24747) order by resume_number;
commit;
