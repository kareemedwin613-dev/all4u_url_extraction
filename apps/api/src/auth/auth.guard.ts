import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { JwtVerifier } from "./jwt-verifier.service.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { ApiRequest } from "../common/types/request.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(JwtVerifier) private readonly verifier: JwtVerifier) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ApiRequest>(), header = request.header("authorization") || "", match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new ApiException("UNAUTHORIZED", "A Bearer access token is required.", HttpStatus.UNAUTHORIZED);
    request.user = await this.verifier.verify(match[1]);
    return true;
  }
}
