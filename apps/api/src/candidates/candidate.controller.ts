import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { CandidateEducationDto, CandidateEmploymentDto, UpdateCandidateProfileDto } from "./candidate.dto.js";
import { CandidateService } from "./candidate.service.js";

const READERS = ["APPLIER", "APPLYING_MANAGER", "ADMIN"] as const, MANAGERS = ["APPLYING_MANAGER", "ADMIN"] as const;
@ApiTags("Candidate Profiles") @ApiBearerAuth() @Controller("candidates") @UseGuards(AuthGuard, RolesGuard) @Throttle({ default: { limit: 60, ttl: 60000 } })
export class CandidateController {
  constructor(@Inject(CandidateService) private readonly service: CandidateService) {}
  private response(request: ApiRequest, data: unknown) { return { data, requestId: request.requestId }; }
  @Get(":id/autofill-profile") @RequireRoles(...READERS) @ApiOperation({ summary: "Load a reviewable Resume-scoped Candidate Profile" })
  async get(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.get(request.user!, id)); }
  @Patch(":id/profile") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Review and update Candidate personal/contact details" })
  async update(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(UpdateCandidateProfileDto)) body: UpdateCandidateProfileDto) { return this.response(request, await this.service.update(request.user!, id, body)); }
  @Post(":id/employment") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Add Candidate employment history" })
  async addEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body)); }
  @Patch(":id/employment/:employmentId") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Update Candidate employment history" })
  async updateEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("employmentId", new ParseUUIDPipe({ version: "4" })) employmentId: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body, employmentId)); }
  @Post(":id/education") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Add Candidate education" })
  async addEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body)); }
  @Patch(":id/education/:educationId") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Update Candidate education" })
  async updateEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("educationId", new ParseUUIDPipe({ version: "4" })) educationId: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body, educationId)); }
}
