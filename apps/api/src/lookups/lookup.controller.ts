import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { LookupService } from "./lookup.service.js";

const BUSINESS_ROLES = ["APPLIER", "APPLYING_MANAGER", "DEVELOPER", "DEVELOPMENT_MANAGER", "JD_FINDER", "ADMIN"] as const;

@ApiTags("Lookups")
@ApiBearerAuth()
@Controller("lookups")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles(...BUSINESS_ROLES)
export class LookupController {
  constructor(@Inject(LookupService) private readonly lookups: LookupService) {}
  @Get("categories") @ApiOperation({ summary: "List active job and resume categories" })
  async categories(@Req() request: ApiRequest) { return { data: await this.lookups.categories(request.user!), requestId: request.requestId }; }
  @Get("industry-domains") @ApiOperation({ summary: "List active industry-domain categories" })
  async industryDomains(@Req() request: ApiRequest) { return { data: await this.lookups.industryDomains(request.user!), requestId: request.requestId }; }
}
