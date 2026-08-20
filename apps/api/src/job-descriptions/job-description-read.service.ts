import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { JobCountQueryDto, JobDescriptionQueryDto, RecentJobsQueryDto } from "./job-description-query.dto.js";
import type { JobDescriptionCorrectionDto } from "./job-description-correction.dto.js";
import { normalizeSourceUrl } from "../extension-ingestion/job-description.service.js";

export const JOB_LIST_FIELDS = "id,user_id,company,job_title,category_id,subcategory_id,industry_domain_category_id,seniority,location_text,work_arrangement,source_site,source_url,status,review_status,review_comment,review_decline_reason,reviewed_by,reviewed_at,created_at,updated_at,primary_category:categories!job_descriptions_category_id_fkey(name),industry_domain:industry_domain_categories!job_descriptions_industry_domain_category_fkey(name,slug),captured_by:user_profiles!job_descriptions_user_profile_fkey(display_name,email)";
export const JOB_DETAIL_FIELDS = `${JOB_LIST_FIELDS},description_text,detected_skills,clearance_requirements,travel_required,travel_details,salary_min,salary_max,salary_currency,salary_period,salary_text,capture_method,extraction_confidence,archived_at,archived_by,archive_reason`;
const SORTS: Record<string, { column: string; ascending: boolean }> = {};
for (const [key, column] of Object.entries({ company:"company", title:"job_title", category:"category_id", subcategory:"subcategory_id", seniority:"seniority", source:"source_url", capturer:"user_id", status:"status", review:"review_status", created:"created_at" })) {
  SORTS[`${key}_asc`] = { column, ascending: true };
  SORTS[`${key}_desc`] = { column, ascending: false };
}

function normalizeJob(job: any) {
  if (!job) return job;
  const category = Array.isArray(job.primary_category) ? job.primary_category[0] : job.primary_category;
  const industry = Array.isArray(job.industry_domain) ? job.industry_domain[0] : job.industry_domain;
  const { primary_category: _primaryCategory, ...rest } = job;
  return { ...rest, category_name: category?.name || null, industry_domain: industry?.name || null };
}

function databaseError(error: any, fallback: string): never {
  if (/JOB_EDIT_LOCKED/i.test(String(error?.message || ""))) throw new ApiException("JOB_EDIT_LOCKED", "Approved and declined job descriptions are locked. Ask a reviewer to request a correction.", HttpStatus.CONFLICT);
  if (/JOB_DUPLICATE/i.test(String(error?.message || ""))) throw new ApiException("JOB_DUPLICATE", "Another job description already has this URL or company and job title.", HttpStatus.CONFLICT);
  if (/JOB_NOT_FOUND/i.test(String(error?.message || ""))) throw new ApiException("JOB_NOT_FOUND", "The job description was not found or does not belong to you.", HttpStatus.NOT_FOUND);
  if (error?.code === "42501" || /row-level security|permission denied/i.test(String(error?.message || ""))) throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  throw new ApiException("DATABASE_ERROR", fallback, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class JobDescriptionReadService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser, filters: JobDescriptionQueryDto) {
    const page = filters.page || 1, pageSize = filters.pageSize || 25, from = (page - 1) * pageSize, sort = SORTS[filters.sort || "created_desc"] || SORTS.created_desc;
    if (filters.capturedFrom && filters.capturedTo && new Date(filters.capturedFrom) >= new Date(filters.capturedTo)) throw new ApiException("INVALID_CAPTURED_RANGE", "The captured date range is invalid.", HttpStatus.BAD_REQUEST);
    let query: any = this.supabase.forUser(user.token).from("job_descriptions").select(JOB_LIST_FIELDS, { count: "exact" });
    if (filters.search) query = query.textSearch("search_vector", filters.search, { type: "websearch", config: "english" });
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.seniority) query = query.eq("seniority", filters.seniority);
    if (filters.status !== "ALL") query = query.eq("status", filters.status || "ACTIVE");
    if (filters.reviewStatus && filters.reviewStatus !== "ALL") query = query.eq("review_status", filters.reviewStatus);
    if (filters.capturedByUserId) query = query.eq("user_id", filters.capturedByUserId);
    if (filters.capturedFrom) query = query.gte("created_at", filters.capturedFrom);
    if (filters.capturedTo) query = query.lt("created_at", filters.capturedTo);
    const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).range(from, from + pageSize - 1);
    if (error) databaseError(error, "Job descriptions could not be loaded.");
    const total = Math.max(0, Number(count) || 0), pageCount = total ? Math.ceil(total / pageSize) : 0, safePage = pageCount ? Math.min(page, pageCount) : 1;
    return { items: (data || []).map(normalizeJob), total, page: safePage, pageSize, pageCount, from: total ? (safePage - 1) * pageSize + 1 : 0, to: total ? Math.min(safePage * pageSize, total) : 0, hasPrevious: safePage > 1, hasNext: safePage < pageCount };
  }

  async capturers(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_job_description_capturers");
    if (error) databaseError(error, "The job-description capturer list could not be loaded.");
    return (data || []).map((item: any) => ({
      id: item.id,
      displayName: item.display_name,
      email: item.email,
      capturedCount: Number(item.captured_count) || 0,
    }));
  }

  async detail(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).from("job_descriptions").select(JOB_DETAIL_FIELDS).eq("id", id).maybeSingle();
    if (error) databaseError(error, "The job description could not be loaded.");
    return normalizeJob(data);
  }

  async status(user: AuthenticatedUser, id: string, status: string, reason?: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("set_job_description_archived_state_v24", { p_job_description_id: id, p_status: status, p_reason: reason || null });
    if (error) databaseError(error, "The captured URL review state could not be updated.");
    return data;
  }

  async review(user: AuthenticatedUser, id: string, reviewStatus: string, declineReason?: string, comment?: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("review_job_description_v27", {
      p_job_description_id: id,
      p_review_status: reviewStatus,
      p_decline_reason: declineReason || null,
      p_comment: comment || null,
    });
    if (error) databaseError(error, "The job-description review decision could not be saved.");
    return data;
  }

  async correct(user: AuthenticatedUser, id: string, input: JobDescriptionCorrectionDto) {
    if (input.salaryMin != null && input.salaryMax != null && input.salaryMax < input.salaryMin) throw new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, { salaryMax: ["Salary maximum must be at least the minimum."] });
    const sourceUrl = input.sourceUrl.trim(), normalizedUrl = normalizeSourceUrl(sourceUrl);
    const { data, error } = await this.supabase.forUser(user.token).rpc("update_my_job_description_v31", {
      p_job_description_id: id,
      p_company: input.company,
      p_job_title: input.jobTitle,
      p_category_id: input.categoryId,
      p_subcategory_id: input.subcategoryId || null,
      p_seniority: input.seniority || "UNSPECIFIED",
      p_location_text: input.locationText || null,
      p_work_arrangement: input.workArrangement || "UNSPECIFIED",
      p_source_url: sourceUrl,
      p_normalized_source_url: normalizedUrl,
      p_source_site: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
      p_description_text: input.descriptionText,
      p_detected_skills: [...new Set((input.detectedSkills || []).map(value => value.trim()).filter(Boolean))],
      p_clearance_requirements: [...new Set((input.clearanceRequirements || []).map(value => value.trim()).filter(Boolean))],
      p_travel_required: input.travelRequired ?? null,
      p_travel_details: input.travelDetails || null,
      p_salary_min: input.salaryMin ?? null,
      p_salary_max: input.salaryMax ?? null,
      p_salary_currency: input.salaryCurrency || null,
      p_salary_period: input.salaryPeriod || null,
      p_salary_text: input.salaryText || null,
    });
    if (error) databaseError(error, "The job-description correction could not be saved.");
    return data;
  }

  async count(user: AuthenticatedUser, filters: JobCountQueryDto) {
    let query: any = this.supabase.forUser(user.token).from("job_descriptions").select("id", { count: "exact", head: true });
    if (filters.status) query = query.eq("status", filters.status);
    const { count, error } = await query;
    if (error) databaseError(error, "The job-description count could not be loaded.");
    return Math.max(0, Number(count) || 0);
  }

  async recent(user: AuthenticatedUser, filters: RecentJobsQueryDto) {
    const { data, error } = await this.supabase.forUser(user.token).from("job_descriptions").select(JOB_LIST_FIELDS).eq("status", "ACTIVE").order("created_at", { ascending: false }).limit(filters.limit || 5);
    if (error) databaseError(error, "Recent job descriptions could not be loaded.");
    return (data || []).map(normalizeJob);
  }
}
