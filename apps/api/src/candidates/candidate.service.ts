import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { CandidateEducationDto, CandidateEmploymentDto, UpdateCandidateProfileDto } from "./candidate.dto.js";

function failure(error: any, fallback: string): never {
  const raw = String(error?.message || ""), known = raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
  const code = known?.[1] || (error?.code === "42501" ? "CANDIDATE_PROFILE_ACCESS_DENIED" : "DATABASE_ERROR");
  const status = error?.code === "42501" || code.includes("ACCESS_DENIED") ? HttpStatus.FORBIDDEN : code.includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : known ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
  throw new ApiException(code, known?.[2] || fallback, status);
}

@Injectable()
export class CandidateService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  private async rpc(user: AuthenticatedUser, name: string, args: Record<string, unknown>, fallback: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result: any = await Promise.race([
        this.supabase.forUser(user.token).rpc(name, args),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiException("UPSTREAM_TIMEOUT", "The Candidate Profile request timed out. Try again.", HttpStatus.GATEWAY_TIMEOUT)), 10000); }),
      ]);
      if (result.error) failure(result.error, fallback);
      return result.data;
    } finally { if (timer) clearTimeout(timer); }
  }
  get(user: AuthenticatedUser, id: string) { return this.rpc(user, "get_candidate_autofill_profile_v088", { p_profile_id: id }, "The Candidate Profile could not be loaded."); }
  update(user: AuthenticatedUser, id: string, value: UpdateCandidateProfileDto) { return this.rpc(user, "update_candidate_profile_v088", { p_profile_id: id, p_full_name: value.fullName.trim(), p_first_name: value.firstName?.trim() || null, p_middle_name: value.middleName?.trim() || null, p_last_name: value.lastName?.trim() || null, p_email: value.email?.trim().toLowerCase() || null, p_phone: value.phone?.trim() || null, p_review_status: value.reviewStatus, p_primary_address: value.primaryAddress || null, p_links: value.links || [] }, "The Candidate Profile could not be updated."); }
  employment(user: AuthenticatedUser, id: string, value: CandidateEmploymentDto, employmentId?: string) { return this.rpc(user, employmentId ? "update_candidate_employment_v088" : "create_candidate_employment_v088", { p_profile_id: id, ...(employmentId ? { p_employment_id: employmentId } : {}), p_company: value.company.trim(), p_job_title: value.jobTitle.trim(), p_location: value.location?.trim() || null, p_start_date: value.startDate || null, p_end_date: value.isCurrent ? null : value.endDate || null, p_is_current: value.isCurrent, p_experience_details: value.experienceDetails?.trim() || null, p_display_order: value.displayOrder || 0 }, "The employment record could not be saved."); }
  education(user: AuthenticatedUser, id: string, value: CandidateEducationDto, educationId?: string) { return this.rpc(user, educationId ? "update_candidate_education_v088" : "create_candidate_education_v088", { p_profile_id: id, ...(educationId ? { p_education_id: educationId } : {}), p_institution: value.institution.trim(), p_degree: value.degree?.trim() || null, p_field_of_study: value.fieldOfStudy?.trim() || null, p_location: value.location?.trim() || null, p_start_date: value.startDate || null, p_end_date: value.endDate || null, p_gpa: value.gpa?.trim() || null, p_details: value.details?.trim() || null, p_display_order: value.displayOrder || 0 }, "The education record could not be saved."); }
}
