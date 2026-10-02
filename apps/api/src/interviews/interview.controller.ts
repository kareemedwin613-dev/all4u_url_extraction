import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { InterviewDto } from "./interview.dto.js";
import { InterviewService } from "./interview.service.js";

const READERS = ["APPLIER", "APPLYING_MANAGER", "ADMIN", "INTERVIEWEE"] as const;
const EDITORS = ["APPLIER", "APPLYING_MANAGER", "ADMIN"] as const;

@ApiTags("Interviews")
@ApiBearerAuth()
@Controller("interviews")
@UseGuards(AuthGuard, RolesGuard)
export class InterviewController {
  constructor(@Inject(InterviewService) private readonly interviews: InterviewService) {}

  @Get()
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List interviews in a date range or for one Application" })
  async list(
    @Req() request: ApiRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("applicationId") applicationId?: string,
  ) {
    return { data: await this.interviews.list(request.user!, from, to, applicationId), requestId: request.requestId };
  }

  @Get("interviewees")
  @RequireRoles(...EDITORS)
  @ApiOperation({ summary: "List active users with the Interviewee role" })
  async interviewees(@Req() request: ApiRequest) {
    return { data: await this.interviews.interviewees(request.user!), requestId: request.requestId };
  }

  @Get("application-defaults/:applicationId")
  @RequireRoles(...EDITORS)
  @ApiOperation({ summary: "Prefill an interview from an Application" })
  async defaults(@Req() request: ApiRequest, @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string) {
    return { data: await this.interviews.defaults(request.user!, applicationId), requestId: request.requestId };
  }

  @Get(":id")
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "Get one interview" })
  async get(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.interviews.get(request.user!, id), requestId: request.requestId };
  }

  @Post()
  @RequireRoles(...EDITORS)
  @ApiOperation({ summary: "Record an interview" })
  async create(@Req() request: ApiRequest, @Body(new DtoValidationPipe(InterviewDto)) body: InterviewDto) {
    return { data: await this.interviews.save(request.user!, body), requestId: request.requestId };
  }

  @Patch(":id")
  @RequireRoles(...EDITORS)
  @ApiOperation({ summary: "Update an interview" })
  async update(
    @Req() request: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(InterviewDto)) body: InterviewDto,
  ) {
    return { data: await this.interviews.save(request.user!, body, id), requestId: request.requestId };
  }

  @Delete(":id")
  @RequireRoles(...EDITORS)
  @ApiOperation({ summary: "Delete an interview" })
  async remove(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.interviews.remove(request.user!, id), requestId: request.requestId };
  }
}
