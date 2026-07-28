import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { JobDescriptionReadController } from "./job-description-read.controller.js";
import { JobDescriptionReadService } from "./job-description-read.service.js";

@Module({ imports: [AuthModule], controllers: [JobDescriptionReadController], providers: [JobDescriptionReadService] })
export class JobDescriptionReadModule {}
