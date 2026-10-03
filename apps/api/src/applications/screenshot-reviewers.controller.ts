import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import type { ApiRequest } from "../common/types/request.js";
import { ApplicationService } from "./application.service.js";
import { ProfileScreenshotApplicationsQueryDto, ScreenshotReviewAssignmentsQueryDto, SetScreenshotReviewersDto } from "./screenshot-reviewers.dto.js";

const READERS = ["APPLIER", "APPLYING_MANAGER", "ADMIN"] as const;
const MANAGERS = ["APPLYING_MANAGER", "ADMIN"] as const;

@ApiTags("Screenshot reviewers")
@ApiBearerAuth()
@Controller("screenshot-reviewers")
@UseGuards(AuthGuard, RolesGuard)
export class ScreenshotReviewersController {
  constructor(@Inject(ApplicationService) private readonly applications: ApplicationService) {}

  private response(request: ApiRequest, data: unknown) {
    return { data, requestId: request.requestId };
  }

  @Get()
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List applicant profiles and their screenshot reviewers" })
  async list(@Req() request: ApiRequest, @Query(new DtoValidationPipe(ScreenshotReviewAssignmentsQueryDto)) query: ScreenshotReviewAssignmentsQueryDto) {
    return this.response(request, await this.applications.listScreenshotReviewAssignments(request.user!, query.from, query.to));
  }

  @Get("candidates")
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List active users who can review screenshots" })
  async candidates(@Req() request: ApiRequest) {
    return this.response(request, await this.applications.listScreenshotReviewerCandidates(request.user!));
  }

  @Put(":resumeId")
  @RequireRoles(...MANAGERS)
  @ApiOperation({ summary: "Assign the primary and secondary screenshot reviewers for one applicant profile" })
  async assign(
    @Req() request: ApiRequest,
    @Param("resumeId", new ParseUUIDPipe({ version: "4" })) resumeId: string,
    @Body(new DtoValidationPipe(SetScreenshotReviewersDto)) body: SetScreenshotReviewersDto,
  ) {
    return this.response(request, await this.applications.setScreenshotProfileReviewers(request.user!, resumeId, body));
  }

  @Get(":resumeId/applications")
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List screenshot applications for one assigned applicant profile" })
  async applicationsForProfile(
    @Req() request: ApiRequest,
    @Param("resumeId", new ParseUUIDPipe({ version: "4" })) resumeId: string,
    @Query(new DtoValidationPipe(ProfileScreenshotApplicationsQueryDto)) query: ProfileScreenshotApplicationsQueryDto,
  ) {
    return this.response(request, await this.applications.listProfileScreenshotApplications(request.user!, resumeId, query.page, query.pageSize, query.from || null, query.to || null, query.review || null));
  }
}
