import { Controller, Get, HttpStatus, Inject, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiException } from "../common/errors/api.exception.js";
import type { ApiRequest } from "../common/types/request.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { AuthGuard } from "./auth.guard.js";

@ApiTags("Access")
@ApiBearerAuth()
@Controller("access-context")
@UseGuards(AuthGuard)
export class AccessContextController {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  @Get() @ApiOperation({ summary: "Load the authenticated user's application profile and roles" })
  async get(@Req() request: ApiRequest) {
    const { data, error } = await this.supabase.accessContext(request.user!.token);
    if (error) {
      const authenticationFailure = error.status === 401 || error.code === "PGRST301";
      throw new ApiException(authenticationFailure ? "UNAUTHORIZED" : "ACCESS_CONTEXT_FAILED", authenticationFailure ? "Your Supabase session is no longer valid. Sign in again." : "Your access context could not be loaded.", authenticationFailure ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_GATEWAY, { reason: error.code });
    }
    return { data, requestId: request.requestId };
  }
}
