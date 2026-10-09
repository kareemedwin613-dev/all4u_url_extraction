import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { DraftAutofillAnswersDto, RecognizeAutofillQuestionsDto, SaveAutofillAiSettingsDto, SetAutofillAiAccessDto, TestAutofillAiModelDto } from "./autofill-ai.dto.js";
import { AutofillAiService } from "./autofill-ai.service.js";

@ApiTags("Extension sessions")
@ApiBearerAuth()
@Controller("extension-sessions")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLIER", "APPLYING_MANAGER", "ADMIN")
export class AutofillAiController {
  constructor(@Inject(AutofillAiService) private readonly service: AutofillAiService) {}

  @Post(":id/autofill-ai/recognize")
  @ApiOperation({ summary: "Match unanswered employer questions to known Autofill answers (learned wordings first, then the model)" })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async recognize(
    @Req() request: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(RecognizeAutofillQuestionsDto)) body: RecognizeAutofillQuestionsDto,
  ) {
    return { data: await this.service.recognize(request.user!, id, body), requestId: request.requestId };
  }

  @Post(":id/autofill-ai/draft")
  @ApiOperation({ summary: "Draft answers to open-ended questions from this session's Resume and job description (a person reviews them)" })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async draft(
    @Req() request: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(DraftAutofillAnswersDto)) body: DraftAutofillAnswersDto,
  ) {
    return { data: await this.service.draft(request.user!, id, body), requestId: request.requestId };
  }
}

@ApiTags("Autofill AI")
@ApiBearerAuth()
@Controller("autofill-ai")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("ADMIN")
export class AutofillAiUsageController {
  constructor(@Inject(AutofillAiService) private readonly service: AutofillAiService) {}

  @Get("usage")
  @ApiOperation({ summary: "AI Autofill usage and cost for the Overview: hourly usage in the period, month spend against the cap, settings" })
  async usage(@Req() request: ApiRequest, @Query("from") from?: string, @Query("to") to?: string) {
    const instant = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    return { data: await this.service.usage(request.user!, instant(from), instant(to)), requestId: request.requestId };
  }

  @Get("appliers")
  @ApiOperation({ summary: "Each person's AI Autofill access (Off, Match, Draft) and their AI usage in the period" })
  async appliers(@Req() request: ApiRequest, @Query("from") from?: string, @Query("to") to?: string) {
    const instant = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    return { data: await this.service.appliers(request.user!, instant(from), instant(to)), requestId: request.requestId };
  }

  @Put("appliers/:userId")
  @ApiOperation({ summary: "Give one person AI Autofill access: OFF, MATCH (match questions) or DRAFT (also draft answers)" })
  async setAccess(
    @Req() request: ApiRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body(new DtoValidationPipe(SetAutofillAiAccessDto)) body: SetAutofillAiAccessDto,
  ) {
    return { data: await this.service.setAccess(request.user!, userId, body.level), requestId: request.requestId };
  }

  @Get("settings")
  @ApiOperation({ summary: "AI settings, recent changes, providers (with whether each key is set) and the models this server can price" })
  async settings(@Req() request: ApiRequest) {
    return { data: await this.service.getSettings(request.user!), requestId: request.requestId };
  }

  @Put("settings")
  @ApiOperation({ summary: "Change AI on/off, provider, models and monthly cap. API keys stay in the environment." })
  async saveSettings(@Req() request: ApiRequest, @Body(new DtoValidationPipe(SaveAutofillAiSettingsDto)) body: SaveAutofillAiSettingsDto) {
    return { data: await this.service.saveSettings(request.user!, body), requestId: request.requestId };
  }

  @Post("settings/test")
  @ApiOperation({ summary: "Run ten sample questions against a provider and model; reports accuracy, speed and cost" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async test(@Req() request: ApiRequest, @Body(new DtoValidationPipe(TestAutofillAiModelDto)) body: TestAutofillAiModelDto) {
    return { data: await this.service.testModel(request.user!, body), requestId: request.requestId };
  }
}
