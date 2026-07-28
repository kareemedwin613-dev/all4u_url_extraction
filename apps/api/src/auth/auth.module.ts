import { Module } from "@nestjs/common";
import { JwtVerifier } from "./jwt-verifier.service.js";
import { AuthGuard } from "./auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";
import { AccessContextController } from "./access-context.controller.js";

@Module({ controllers: [AccessContextController], providers: [JwtVerifier, AuthGuard, RolesGuard, JsonLogger], exports: [JwtVerifier, AuthGuard, RolesGuard, JsonLogger] })
export class AuthModule {}
