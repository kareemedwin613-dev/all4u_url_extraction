import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { JobDescriptionController } from "./job-description.controller.js";
import { JobDescriptionService } from "./job-description.service.js";
import { JdValidationPipe } from "./jd-validation.pipe.js";

@Module({ imports: [AuthModule], controllers: [JobDescriptionController], providers: [JobDescriptionService, JdValidationPipe] })
export class ExtensionIngestionModule {}
