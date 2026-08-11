import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { JobCountQueryDto, JobDescriptionQueryDto, RecentJobsQueryDto } from "./job-description-query.dto.js";

export const JOB_LIST_FIELDS = "id,user_id,company,job_title,category_id,subcategory_id,industry_domain_category_id,seniority,location_text,work_arrangement,source_site,status,created_at,updated_at,industry_domain:industry_domain_categories!job_descriptions_industry_domain_category_fkey(name,slug),captured_by:user_profiles!job_descriptions_user_profile_fkey(display_name,email)";
export const JOB_DETAIL_FIELDS = `${JOB_LIST_FIELDS},source_url,description_text,detected_skills,clearance_requirements,travel_required,travel_details,salary_min,salary_max,salary_currency,salary_period,salary_text,capture_method,extraction_confidence,archived_at,archived_by,archive_reason`;
const SORTS: Record<string, { column: string; ascending: boolean }> = {};
for (const [key, column] of Object.entries({ company:"company", title:"job_title", category:"category_id", subcategory:"subcategory_id", seniority:"seniority", source:"source_site", capturer:"user_id", status:"status", created:"created_at" })) {
  SORTS[`${key}_asc`] = { column, ascending: true };
  SORTS[`${key}_desc`] = { column, ascending: false };
}

function normalizeJob(job: any) {
  return job ? { ...job, industry_domain: Array.isArray(job.industry_domain) ? job.industry_domain[0]?.name || null : job.industry_domain?.name || null } : job;
}

function databaseError(error: any, fallback: string): never {
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
