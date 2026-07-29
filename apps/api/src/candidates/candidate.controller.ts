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
@ApiTags("Resume Autofill Metadata") @ApiBearerAuth() @Controller("candidates") @UseGuards(AuthGuard, RolesGuard) @Throttle({ default: { limit: 60, ttl: 60000 } })
export class CandidateController {
  constructor(@Inject(CandidateService) private readonly service: CandidateService) {}
  private response(request: ApiRequest, data: unknown) { return { data, requestId: request.requestId }; }
  @Get(":id/autofill-profile") @RequireRoles(...READERS) @ApiOperation({ summary: "Load reviewable autofill metadata from a Resume" })
  async get(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.get(request.user!, id)); }
  @Patch(":id/profile") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Review and update Resume personal/contact metadata" })
  async update(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(UpdateCandidateProfileDto)) body: UpdateCandidateProfileDto) { return this.response(request, await this.service.update(request.user!, id, body)); }
  @Post(":id/employment") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Add Candidate employment history" })
  async addEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body)); }
  @Post(":id/employment/import") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Import legacy employment metadata into the Resume once" })
  async importEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.importEmployment(request.user!, id)); }
  @Patch(":id/employment/:employmentId") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Update Candidate employment history" })
  async updateEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("employmentId", new ParseUUIDPipe({ version: "4" })) employmentId: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body, employmentId)); }
  @Post(":id/education") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Add Candidate education" })
  async addEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body)); }
  @Patch(":id/education/:educationId") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Update Candidate education" })
  async updateEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("educationId", new ParseUUIDPipe({ version: "4" })) educationId: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body, educationId)); }
}

/** Canonical Resume-owned routes. CandidateController remains a v0.8.8 compatibility alias. */
@ApiTags("Resume Autofill Metadata") @ApiBearerAuth() @Controller("resumes") @UseGuards(AuthGuard, RolesGuard) @Throttle({ default: { limit: 60, ttl: 60000 } })
export class ResumeAutofillController {
  constructor(@Inject(CandidateService) private readonly service: CandidateService) {}
  private response(request: ApiRequest, data: unknown) { return { data, requestId: request.requestId }; }
  @Get(":id/autofill-profile") @RequireRoles(...READERS)
  async get(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.get(request.user!, id)); }
  @Patch(":id/autofill-profile") @RequireRoles(...MANAGERS)
  async update(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(UpdateCandidateProfileDto)) body: UpdateCandidateProfileDto) { return this.response(request, await this.service.update(request.user!, id, body)); }
  @Post(":id/autofill-employment") @RequireRoles(...MANAGERS)
  async addEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body)); }
  @Post(":id/autofill-employment/import") @RequireRoles(...MANAGERS) @ApiOperation({ summary: "Import legacy Resume employment metadata once" })
  async importEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.importEmployment(request.user!, id)); }
  @Patch(":id/autofill-employment/:employmentId") @RequireRoles(...MANAGERS)
  async updateEmployment(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("employmentId", new ParseUUIDPipe({ version: "4" })) employmentId: string, @Body(new DtoValidationPipe(CandidateEmploymentDto)) body: CandidateEmploymentDto) { return this.response(request, await this.service.employment(request.user!, id, body, employmentId)); }
  @Post(":id/autofill-education") @RequireRoles(...MANAGERS)
  async addEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body)); }
  @Patch(":id/autofill-education/:educationId") @RequireRoles(...MANAGERS)
  async updateEducation(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("educationId", new ParseUUIDPipe({ version: "4" })) educationId: string, @Body(new DtoValidationPipe(CandidateEducationDto)) body: CandidateEducationDto) { return this.response(request, await this.service.education(request.user!, id, body, educationId)); }
}
