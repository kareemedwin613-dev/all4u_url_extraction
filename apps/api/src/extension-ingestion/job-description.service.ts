import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { CreateJobDescriptionDto } from "./create-job-description.dto.js";

const FIELDS = "id,company,job_title,category_id,subcategory_id,industry_domain_category_id,seniority,location_text,work_arrangement,clearance_requirements,travel_required,travel_details,salary_min,salary_max,salary_currency,salary_period,salary_text,source_site,source_url,description_text,detected_skills,capture_method,extraction_confidence,created_at";
const TRACKING = new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","trk","trackingid","ref"]);
export function normalizeSourceUrl(value: string): string {
  const url = new URL(value); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  url.searchParams.sort(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
const cleanArray = (values: string[] = []) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const normalizeIdentityText = (value: string) => value.replace(/\s+/g, " ").trim();

@Injectable()
export class JobDescriptionService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async create(user: AuthenticatedUser, input: CreateJobDescriptionDto) {
    if (input.salaryMin != null && input.salaryMax != null && input.salaryMax < input.salaryMin) throw new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, { salaryMax: ["Salary maximum must be at least the minimum."] });
    const normalizedUrl = normalizeSourceUrl(input.sourceUrl), normalizedCompany = normalizeIdentityText(input.company), normalizedJobTitle = normalizeIdentityText(input.jobTitle), client = this.supabase.forUser(user.token), row = {
      user_id: user.id,
      company: normalizedCompany,
      job_title: normalizedJobTitle,
      category_id: input.categoryId,
      subcategory_id: input.subcategoryId || null,
      industry_domain_category_id: input.industryDomainCategoryId || null,
      seniority: input.seniority || "UNSPECIFIED",
      location_text: input.locationText || null,
      work_arrangement: input.workArrangement || "UNSPECIFIED",
      clearance_requirements: cleanArray(input.clearanceRequirements),
      travel_required: input.travelRequired ?? null,
      travel_details: input.travelDetails || null,
      salary_min: input.salaryMin ?? null,
      salary_max: input.salaryMax ?? null,
      salary_currency: input.salaryCurrency || null,
      salary_period: input.salaryPeriod || null,
      salary_text: input.salaryText || null,
      source_site: input.sourceWebsite || new URL(normalizedUrl).hostname.replace(/^www\./, ""),
      source_url: input.sourceUrl,
      normalized_source_url: normalizedUrl,
      captured_at_client: input.capturedAt || null,
      description_text: input.descriptionText,
      detected_skills: cleanArray(input.detectedSkills),
      capture_method: input.captureMethod || "manual",
      extraction_confidence: input.extractionConfidence || "low",
    };
    const urlMatch = await client.from("job_descriptions").select(FIELDS).eq("user_id", user.id).eq("normalized_source_url", normalizedUrl).limit(1).maybeSingle();
    if (urlMatch.error) {
      if (urlMatch.error.code === "42501" || /row-level security|permission denied/i.test(urlMatch.error.message)) throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
      throw new ApiException("DATABASE_ERROR", "Duplicate checking could not be completed.", HttpStatus.BAD_GATEWAY);
    }
    if (urlMatch.data) return { row: urlMatch.data, duplicate: true, duplicateReason: "SOURCE_URL" as const };
    const identityMatch = await client.from("job_descriptions").select(FIELDS).eq("user_id", user.id).ilike("company", escapeLike(normalizedCompany)).ilike("job_title", escapeLike(normalizedJobTitle)).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (identityMatch.error) {
      if (identityMatch.error.code === "42501" || /row-level security|permission denied/i.test(identityMatch.error.message)) throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
      throw new ApiException("DATABASE_ERROR", "Duplicate checking could not be completed.", HttpStatus.BAD_GATEWAY);
    }
    if (identityMatch.data) return { row: identityMatch.data, duplicate: true, duplicateReason: "COMPANY_JOB_TITLE" as const };
    const { data, error } = await client.from("job_descriptions").insert(row).select(FIELDS).single();
    if (!error) return { row: data, duplicate: false, duplicateReason: null };
    if (error.code === "23505") {
      const existing = await client.from("job_descriptions").select(FIELDS).eq("user_id", user.id).eq("normalized_source_url", normalizedUrl).maybeSingle();
      if (existing.error || !existing.data) throw new ApiException("DATABASE_ERROR", "The existing job description could not be loaded.", HttpStatus.BAD_GATEWAY);
      return { row: existing.data, duplicate: true, duplicateReason: "SOURCE_URL" as const };
    }
    if (error.code === "42501" || /row-level security|permission denied/i.test(error.message)) throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
    if (error.code === "23503" || error.code === "23514") throw new ApiException("VALIDATION_ERROR", "The request conflicts with controlled database values.", HttpStatus.BAD_REQUEST);
    throw new ApiException("DATABASE_ERROR", "The job description could not be saved.", HttpStatus.BAD_GATEWAY);
  }
}
