import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InterviewController } from "./interview.controller.js";
import { InterviewService } from "./interview.service.js";

@Module({ imports: [AuthModule], controllers: [InterviewController], providers: [InterviewService] })
export class InterviewModule {}
