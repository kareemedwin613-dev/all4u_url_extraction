import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { SaveApplicationGuideDto } from "./application-guide.dto.js";
import { ApplicationGuideService } from "./application-guide.service.js";

const READERS = ["APPLIER", "APPLYING_MANAGER", "ADMIN"] as const;

@ApiTags("Application guide")
@ApiBearerAuth()
@Controller("application-guide")
@UseGuards(AuthGuard, RolesGuard)
export class ApplicationGuideController {
  constructor(@Inject(ApplicationGuideService) private readonly guide: ApplicationGuideService) {}

  @Get()
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List published Application Guide entries" })
  async list(@Req() request: ApiRequest) {
    return { data: await this.guide.list(request.user!), requestId: request.requestId };
  }

  @Get("unresolved-questions")
  @RequireRoles("ADMIN")
  @ApiOperation({ summary: "List question wording Autofill met but could not answer" })
  async unresolved(@Req() request: ApiRequest, @Query("days") days?: string) {
    return { data: await this.guide.unresolvedQuestions(request.user!, Math.max(1, Math.min(Number(days) || 30, 365))), requestId: request.requestId };
  }

  @Post("unresolved-questions/:id/dismiss")
  @RequireRoles("ADMIN")
  @ApiOperation({ summary: "Hide an unanswered Autofill question from review" })
  async dismissUnresolved(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.guide.dismissUnresolvedQuestion(request.user!, id), requestId: request.requestId };
  }

  @Post()
  @RequireRoles("ADMIN")
  @ApiOperation({ summary: "Create or update an Application Guide entry" })
  async save(@Req() request: ApiRequest, @Body(new DtoValidationPipe(SaveApplicationGuideDto)) body: SaveApplicationGuideDto) {
    return { data: await this.guide.save(request.user!, body), requestId: request.requestId };
  }

  @Delete(":id")
  @RequireRoles("ADMIN")
  @ApiOperation({ summary: "Delete an Application Guide entry" })
  async remove(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.guide.remove(request.user!, id), requestId: request.requestId };
  }
}
