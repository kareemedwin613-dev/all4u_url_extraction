import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ApplicationGuideController } from "./application-guide.controller.js";
import { ApplicationGuideService } from "./application-guide.service.js";

@Module({ imports: [AuthModule], controllers: [ApplicationGuideController], providers: [ApplicationGuideService] })
export class ApplicationGuideModule {}
