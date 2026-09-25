import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { SYSTEM_ROLES } from "@resume-jd/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { resolveClientIp } from "../common/request/client-ip.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { ApproveExtensionPairingDto, RedeemExtensionPairingDto } from "./extension-pairing.dto.js";
import { ExtensionPairingService } from "./extension-pairing.service.js";

@ApiTags("Extension Pairing")
@Controller("extension-pairings")
export class ExtensionPairingController {
  constructor(@Inject(ExtensionPairingService) private readonly service: ExtensionPairingService) {}

  @Post("approve") @HttpCode(200) @ApiBearerAuth() @UseGuards(AuthGuard, RolesGuard) @RequireRoles(...SYSTEM_ROLES)
  @ApiOperation({ summary: "Approve a Chrome extension connection request from the signed-in dashboard" })
  async approve(@Req() request: ApiRequest, @Body(new DtoValidationPipe(ApproveExtensionPairingDto)) body: ApproveExtensionPairingDto) {
    return { data: await this.service.approve(request.user!, body.pairingId, body.challenge), requestId: request.requestId };
  }

  // Unauthenticated by design: the extension has no session yet and proves itself with the secret.
  // It polls every few seconds for up to 5 minutes, so allow a steady rate per client.
  @Post("redeem") @HttpCode(200) @Throttle({ default: { limit: 45, ttl: 60_000 } })
  @ApiOperation({ summary: "Exchange an approved pairing for a new extension session" })
  async redeem(@Req() request: ApiRequest, @Body(new DtoValidationPipe(RedeemExtensionPairingDto)) body: RedeemExtensionPairingDto) {
    return { data: await this.service.redeem(body.pairingId, body.secret, resolveClientIp(request), String(request.header("user-agent") || "")), requestId: request.requestId };
  }
}
