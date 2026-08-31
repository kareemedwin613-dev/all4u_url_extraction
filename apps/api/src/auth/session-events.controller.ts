import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { resolveClientIp } from "../common/request/client-ip.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { AuthGuard } from "./auth.guard.js";
import { RecordLoginEventDto } from "./session-events.dto.js";
import { SessionEventsService } from "./session-events.service.js";

@ApiTags("Session Events")
@ApiBearerAuth()
@Controller("session-events")
@UseGuards(AuthGuard)
export class SessionEventsController {
  constructor(@Inject(SessionEventsService) private readonly service: SessionEventsService) {}

  @Post("login")
  @ApiOperation({ summary: "Record an explicit dashboard or extension login event" })
  async recordLogin(
    @Req() request: ApiRequest,
    @Body(new DtoValidationPipe(RecordLoginEventDto)) body: RecordLoginEventDto,
  ) {
    const data = await this.service.recordLogin(
      request.user!,
      body.clientType,
      resolveClientIp(request),
      String(request.header("user-agent") || ""),
    );
    return { data, requestId: request.requestId };
  }
}
