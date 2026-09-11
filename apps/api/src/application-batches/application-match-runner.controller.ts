import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import type { ApiRequest } from "../common/types/request.js";
import { ApplicationMatchRunnerService } from "./application-match-runner.service.js";
import { MatchRunnerTicketDto, MatchRunnerNextDto, MatchRunnerDocumentDto, MatchRunnerDocumentResultDto, MatchRunnerResultDto, MatchRunnerFailureDto } from "./application-match-runner.dto.js";

// Like tailoring's runner: the expiring capability in each body, not a user JWT,
// authorizes requests. The database checks ticket scope and lease ownership.
@ApiTags("Application Match Runner") @Controller("application-match-runner")
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class ApplicationMatchRunnerController {
  constructor(@Inject(ApplicationMatchRunnerService) private readonly service: ApplicationMatchRunnerService) {}
  private async out(request: ApiRequest, operation: string, body: object & { ticket: string }) {
    return { data: await this.service.call(operation, { ...body }), requestId: request.requestId };
  }
  @Post("claim") @Throttle({ default: { limit: 20, ttl: 60_000 } })
  claim(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerTicketDto)) b: MatchRunnerTicketDto) { return this.out(r, "claim", b); }
  @Post("next") next(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerNextDto)) b: MatchRunnerNextDto) { return this.out(r, "next", b); }
  @Post("document") document(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerDocumentDto)) b: MatchRunnerDocumentDto) { return this.out(r, "document", b); }
  @Post("document-result") documentResult(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerDocumentResultDto)) b: MatchRunnerDocumentResultDto) { return this.out(r, "document-result", b); }
  @Post("result") result(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerResultDto)) b: MatchRunnerResultDto) { return this.out(r, "result", b); }
  @Post("failure") failure(@Req() r: ApiRequest, @Body(new DtoValidationPipe(MatchRunnerFailureDto)) b: MatchRunnerFailureDto) { return this.out(r, "failure", b); }
}
