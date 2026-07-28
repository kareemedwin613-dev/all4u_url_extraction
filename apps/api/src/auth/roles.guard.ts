import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { SystemRole } from "@resume-jd/contracts";
import { SupabaseService } from "../supabase/supabase.service.js";
import { REQUIRED_ROLES } from "./require-roles.decorator.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { ApiRequest } from "../common/types/request.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(SupabaseService) private readonly supabase: SupabaseService, @Inject(JsonLogger) private readonly logger: JsonLogger) {}
  async canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<SystemRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]) || [];
    if (!roles.length) return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (!request.user) throw new ApiException("UNAUTHORIZED", "Authentication is required.", HttpStatus.UNAUTHORIZED);
    const { data, error } = await this.supabase.accessContext(request.user.token);
    if (error) {
      this.logger.warn("authorization.access_context_failed", { requestId: request.requestId, userId: request.user.id, supabaseCode: error.code, upstreamStatus: error.status });
      const authenticationFailure = error.status === 401 || error.code === "PGRST301";
      throw new ApiException(authenticationFailure ? "UNAUTHORIZED" : "FORBIDDEN", authenticationFailure ? "Your Supabase session is no longer valid. Sign in again." : "Your application access could not be verified.", authenticationFailure ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN, { reason: error.code });
    }
    const source = Array.isArray(data) ? data[0] : data, status = String(source?.status || "").toUpperCase(), assigned = Array.isArray(source?.roles) ? source.roles.map((role: unknown) => String(role).toUpperCase()) : [];
    request.accessContext = { status, roles: assigned };
    if (status !== "ACTIVE") throw new ApiException("FORBIDDEN", "Your platform account is inactive.", HttpStatus.FORBIDDEN);
    if (!roles.some((role) => assigned.includes(role))) throw new ApiException("FORBIDDEN", "Your role does not allow this operation.", HttpStatus.FORBIDDEN);
    return true;
  }
}
