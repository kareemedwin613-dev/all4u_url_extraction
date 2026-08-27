import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { JobCountQueryDto, JobDescriptionQueryDto, RecentJobsQueryDto } from "./job-description-query.dto.js";
import { JobDescriptionReadService } from "./job-description-read.service.js";
import { JobDescriptionStatusDto } from "./job-description-status.dto.js";
import { JobDescriptionReviewDto } from "./job-description-review.dto.js";
import { BulkJobDescriptionReviewDto } from "./bulk-job-description-review.dto.js";
import { BulkJobDescriptionDeleteDto } from "./bulk-job-description-delete.dto.js";
import { JobDescriptionCorrectionDto } from "./job-description-correction.dto.js";

const BUSINESS_ROLES = ["APPLIER", "APPLYING_MANAGER", "DEVELOPER", "DEVELOPMENT_MANAGER", "JD_FINDER", "ADMIN"] as const;

@ApiTags("Job descriptions")
@ApiBearerAuth()
@Controller("job-descriptions")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles(...BUSINESS_ROLES)
export class JobDescriptionReadController {
  constructor(@Inject(JobDescriptionReadService) private readonly jobs: JobDescriptionReadService) {}

  @Get() @ApiOperation({ summary: "List accessible job descriptions" })
  async list(@Req() request: ApiRequest, @Query(new DtoValidationPipe(JobDescriptionQueryDto)) query: JobDescriptionQueryDto) { return { data: await this.jobs.list(request.user!, query), requestId: request.requestId }; }

  @Get("count") @ApiOperation({ summary: "Count accessible job descriptions" })
  async count(@Req() request: ApiRequest, @Query(new DtoValidationPipe(JobCountQueryDto)) query: JobCountQueryDto) { return { data: await this.jobs.count(request.user!, query), requestId: request.requestId }; }

  @Get("recent") @ApiOperation({ summary: "List recently captured job descriptions" })
  async recent(@Req() request: ApiRequest, @Query(new DtoValidationPipe(RecentJobsQueryDto)) query: RecentJobsQueryDto) { return { data: await this.jobs.recent(request.user!, query), requestId: request.requestId }; }

  @Get("capturers") @ApiOperation({ summary: "List users who captured accessible job descriptions" })
  async capturers(@Req() request: ApiRequest) { return { data: await this.jobs.capturers(request.user!), requestId: request.requestId }; }

  @Post("bulk-review") @RequireRoles("APPLYING_MANAGER", "ADMIN") @ApiOperation({ summary: "Apply one review decision to many job descriptions" })
  async bulkReview(@Req() request: ApiRequest, @Body(new DtoValidationPipe(BulkJobDescriptionReviewDto)) body: BulkJobDescriptionReviewDto) {
    return {
      data: await this.jobs.bulkReview(request.user!, body.jobDescriptionIds, body.reviewStatus, body.declineReason, body.comment),
      requestId: request.requestId,
    };
  }

  @Post("bulk-delete") @RequireRoles("APPLYING_MANAGER", "ADMIN") @ApiOperation({ summary: "Permanently delete job descriptions with no applications" })
  async bulkDelete(@Req() request: ApiRequest, @Body(new DtoValidationPipe(BulkJobDescriptionDeleteDto)) body: BulkJobDescriptionDeleteDto) {
    return {
      data: await this.jobs.bulkDelete(request.user!, body.jobDescriptionIds),
      requestId: request.requestId,
    };
  }

  @Patch(":id/status") @RequireRoles("APPLYING_MANAGER", "ADMIN") @ApiOperation({ summary: "Decline/archive or restore a captured job URL" })
  async status(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(JobDescriptionStatusDto)) body: JobDescriptionStatusDto) { return { data: await this.jobs.status(request.user!, id, body.status, body.reason), requestId: request.requestId }; }

  @Patch(":id/review") @RequireRoles("APPLYING_MANAGER", "ADMIN") @ApiOperation({ summary: "Review a captured job description" })
  async review(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(JobDescriptionReviewDto)) body: JobDescriptionReviewDto) { return { data: await this.jobs.review(request.user!, id, body.reviewStatus, body.declineReason, body.comment), requestId: request.requestId }; }

  @Patch(":id/correction") @RequireRoles("JD_FINDER") @ApiOperation({ summary: "Correct one of the caller's unapproved job descriptions" })
  async correct(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(JobDescriptionCorrectionDto)) body: JobDescriptionCorrectionDto) { return { data: await this.jobs.correct(request.user!, id, body), requestId: request.requestId }; }

  @Patch(":id/manager-edit") @RequireRoles("APPLYING_MANAGER", "ADMIN") @ApiOperation({ summary: "Edit an unapproved job description during manager review" })
  async managerEdit(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(JobDescriptionCorrectionDto)) body: JobDescriptionCorrectionDto) { return { data: await this.jobs.managerEdit(request.user!, id, body), requestId: request.requestId }; }

  @Get(":id") @ApiOperation({ summary: "Get one accessible job description" })
  async detail(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return { data: await this.jobs.detail(request.user!, id), requestId: request.requestId }; }
}
