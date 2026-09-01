import { Module } from "@nestjs/common";
import { JwtVerifier } from "./jwt-verifier.service.js";
import { AuthGuard } from "./auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";
import { AccessContextController } from "./access-context.controller.js";
import { SessionEventsController } from "./session-events.controller.js";
import { SessionEventsService } from "./session-events.service.js";

@Module({ controllers: [AccessContextController, SessionEventsController], providers: [JwtVerifier, AuthGuard, RolesGuard, JsonLogger, SessionEventsService], exports: [JwtVerifier, AuthGuard, RolesGuard, JsonLogger, SessionEventsService] })
export class AuthModule {}
