-- v2.8: one-time review reset for every JD that existed at deployment time.
-- Preserve lifecycle/archive history, but require a fresh explicit approval
-- before any existing JD can participate in Application creation.

alter table public.job_descriptions drop constraint if exists job_descriptions_review_state_consistent;
alter table public.job_descriptions add constraint job_descriptions_review_state_consistent check (
  (review_status='DECLINED' and review_decline_reason is not null and status='ARCHIVED') or
  (review_status<>'DECLINED' and review_decline_reason is null)
);

-- A null reviewer identifies a system migration rather than a human decision.
alter table public.job_description_review_history alter column reviewed_by drop not null;

insert into public.job_description_review_history(
  job_description_id,previous_status,new_status,decline_reason,comment,reviewed_by,reviewed_at
)
select id,review_status,'NEEDS_REVIEW',null,
  'System reset: existing JD requires an explicit manager approval.',null,clock_timestamp()
from public.job_descriptions;

-- Avoid attributing the one-time system reset to the migration connection and
-- avoid creating a second audit record through the ordinary human-review trigger.
drop trigger if exists job_descriptions_audit_review_v27 on public.job_descriptions;
drop trigger if exists job_descriptions_maintain_review_v27 on public.job_descriptions;

update public.job_descriptions set
  review_status='NEEDS_REVIEW',
  review_comment=null,
  review_decline_reason=null,
  reviewed_by=null,
  reviewed_at=null;

create trigger job_descriptions_maintain_review_v27
before update of review_status,review_comment,review_decline_reason on public.job_descriptions
for each row execute function public.maintain_job_description_review_v27();

create trigger job_descriptions_audit_review_v27
after update of review_status,review_comment,review_decline_reason on public.job_descriptions
for each row when (old.review_status is distinct from new.review_status or old.review_comment is distinct from new.review_comment or old.review_decline_reason is distinct from new.review_decline_reason)
execute function public.audit_job_description_review_v27();
