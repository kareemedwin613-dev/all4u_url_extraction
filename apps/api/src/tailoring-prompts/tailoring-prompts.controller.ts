import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { CreatePromptDto, SavePromptDto, PromptRevisionDto, RestorePromptDto, PreviewPromptDto, CreatePromptTestDto, PromptTestRunnerDto } from "./tailoring-prompts.dto.js";
import { Throttle } from "@nestjs/throttler";
import { TailoringPromptsService } from "./tailoring-prompts.service.js";

@ApiTags("Tailoring Prompts")
@ApiBearerAuth()
@Controller("tailoring-prompts")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLYING_MANAGER", "ADMIN")
export class TailoringPromptsController {
  constructor(@Inject(TailoringPromptsService) private readonly service: TailoringPromptsService) {}
  private out(r: ApiRequest, data: unknown) { return { data, requestId: r.requestId }; }
  @Get() async list(@Req() r: ApiRequest) { return this.out(r, await this.service.list(r.user!)); }
  @Post() async create(@Req() r: ApiRequest, @Body(new DtoValidationPipe(CreatePromptDto)) body: CreatePromptDto) {
    return this.out(r, await this.service.create(r.user!, body));
  }
  @Post("preview") async preview(@Req() r: ApiRequest, @Body(new DtoValidationPipe(PreviewPromptDto)) body: PreviewPromptDto) {
    return this.out(r, await this.service.preview(r.user!, body.jobDescriptionId));
  }
  @Get(":id") async detail(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.out(r, await this.service.detail(r.user!, id));
  }
  @Get("tests/:id") async testDetail(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.out(r, await this.service.testDetail(r.user!, id));
  }
  @Post(":id/tests") @Throttle({ default: { limit: 10, ttl: 60000 } }) async createTest(@Req() r: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(CreatePromptTestDto)) body: CreatePromptTestDto) {
    return this.out(r, await this.service.createTest(r.user!, id, body.expectedRevision, body.applicationId));
  }
  @Get(":id/history") async history(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.out(r, await this.service.history(r.user!, id));
  }
  @Put(":id/draft") async save(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(SavePromptDto)) body: SavePromptDto) {
    return this.out(r, await this.service.save(r.user!, id, body));
  }
  @Post(":id/publish") async publish(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(PromptRevisionDto)) body: PromptRevisionDto) {
    return this.out(r, await this.service.publish(r.user!, id, body.expectedRevision));
  }
  @Post(":id/archive") async archive(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(PromptRevisionDto)) body: PromptRevisionDto) {
    return this.out(r, await this.service.archive(r.user!, id, body.expectedRevision));
  }
  @Post(":id/restore") async restore(@Req() r: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(RestorePromptDto)) body: RestorePromptDto) {
    return this.out(r, await this.service.restore(r.user!, id, body.expectedRevision, body.version));
  }
}

@ApiTags("Tailoring Prompt Test Runner")
@Controller("tailoring-prompt-test-runner")
export class TailoringPromptTestRunnerController {
  constructor(@Inject(TailoringPromptsService) private readonly service: TailoringPromptsService) {}
  @Post() @Throttle({ default: { limit: 20, ttl: 60000 } })
  async run(@Req() r: ApiRequest, @Body(new DtoValidationPipe(PromptTestRunnerDto)) body: PromptTestRunnerDto) {
    return { data: await this.service.runTest(body), requestId: r.requestId };
  }
}
