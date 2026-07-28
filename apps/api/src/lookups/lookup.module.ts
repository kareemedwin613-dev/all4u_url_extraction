import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { LookupController } from "./lookup.controller.js";
import { LookupService } from "./lookup.service.js";

@Module({ imports: [AuthModule], controllers: [LookupController], providers: [LookupService] })
export class LookupModule {}
