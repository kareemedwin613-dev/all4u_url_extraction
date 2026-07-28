import { Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, errors as JoseErrors } from "jose";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { environment } from "../config/environment.js";
import { ApiException } from "../common/errors/api.exception.js";
import { HttpStatus } from "@nestjs/common";

@Injectable()
export class JwtVerifier {
  private readonly jwks = createRemoteJWKSet(new URL(environment().SUPABASE_JWKS_URL));
  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const env = environment(), options: { issuer: string; audience?: string } = { issuer: env.SUPABASE_JWT_ISSUER };
      if (env.SUPABASE_JWT_AUDIENCE) options.audience = env.SUPABASE_JWT_AUDIENCE;
      const { payload } = await jwtVerify(token, this.jwks, options);
      if (!payload.sub) throw new Error("JWT subject is missing.");
      return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined, token, claims: payload as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof JoseErrors.JWTExpired ? "Your session has expired." : "A valid Supabase access token is required.";
      throw new ApiException("UNAUTHORIZED", message, HttpStatus.UNAUTHORIZED);
    }
  }
}
