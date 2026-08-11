import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { JobCountQueryDto, JobDescriptionQueryDto, RecentJobsQueryDto } from "./job-description-query.dto.js";
import { JobDescriptionReadService } from "./job-description-read.service.js";

const BUSINESS_ROLES = ["APPLIER", "APPLYING_MANAGER", "DEVELOPER", "DEVELOPMENT_MANAGER", "ADMIN"] as const;

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

  @Get(":id") @ApiOperation({ summary: "Get one accessible job description" })
  async detail(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return { data: await this.jobs.detail(request.user!, id), requestId: request.requestId }; }
}
