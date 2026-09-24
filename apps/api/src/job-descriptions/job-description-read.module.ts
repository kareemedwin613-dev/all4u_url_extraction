import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { JobDescriptionReadController } from "./job-description-read.controller.js";
import { JobDescriptionReadService } from "./job-description-read.service.js";
import { JdReviewController, JdReviewRunnerController, JdReviewService } from "./jd-review.controller.js";

@Module({ imports: [AuthModule], controllers: [JobDescriptionReadController, JdReviewController, JdReviewRunnerController], providers: [JobDescriptionReadService, JdReviewService] })
export class JobDescriptionReadModule {}
