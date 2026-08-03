import { Body, Controller, Headers, HttpStatus, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { environment } from "../config/environment.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { ApiRequest } from "../common/types/request.js";
import { CreateJobDescriptionDto } from "./create-job-description.dto.js";
import { JobDescriptionService } from "./job-description.service.js";
import { JdValidationPipe } from "./jd-validation.pipe.js";

@ApiTags("Extension ingestion")
@ApiBearerAuth()
@Controller("extension/job-descriptions")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLYING_MANAGER", "JD_FINDER", "ADMIN")
export class JobDescriptionController {
  constructor(@Inject(JobDescriptionService) private readonly jobs: JobDescriptionService) {}
  @Post()
  @Throttle({ default: { limit: environment().INGESTION_RATE_LIMIT_MAX, ttl: environment().RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: "Save one reviewed Chrome-extension job description" })
  @ApiResponse({ status: 201, description: "Created" })
  @ApiResponse({ status: 200, description: "Existing duplicate returned" })
  @ApiResponse({ status: 400, description: "Validation error" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  @ApiResponse({ status: 403, description: "Inactive or unauthorized user / RLS denial" })
  async create(@Req() request: ApiRequest, @Res({ passthrough: true }) response: Response, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body(JdValidationPipe) body: CreateJobDescriptionDto) {
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) throw new ApiException("VALIDATION_ERROR", "The Idempotency-Key header is invalid.", HttpStatus.BAD_REQUEST, undefined, { idempotencyKey: ["Use 8–200 letters, numbers, dots, underscores, colons, or hyphens."] });
    const result = await this.jobs.create(request.user!, body), row = result.row;
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return { data: { id: row.id, company: row.company, jobTitle: row.job_title, sourceUrl: row.source_url, createdAt: row.created_at, duplicate: result.duplicate, duplicateReason: result.duplicateReason, workspaceSync:result.workspaceSync, categoryId: row.category_id, subcategoryId: row.subcategory_id, industryDomainCategoryId: row.industry_domain_category_id, seniority: row.seniority, locationText: row.location_text, workArrangement: row.work_arrangement, clearanceRequirements: row.clearance_requirements, travelRequired: row.travel_required, travelDetails: row.travel_details, salaryMin: row.salary_min, salaryMax: row.salary_max, salaryCurrency: row.salary_currency, salaryPeriod: row.salary_period, salaryText: row.salary_text, sourceWebsite: row.source_site, descriptionText: row.description_text, detectedSkills: row.detected_skills, captureMethod: row.capture_method, extractionConfidence: row.extraction_confidence }, requestId: request.requestId };
  }
}
