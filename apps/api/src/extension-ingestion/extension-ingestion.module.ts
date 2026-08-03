import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { JobDescriptionController } from "./job-description.controller.js";
import { JobDescriptionService } from "./job-description.service.js";
import { JdValidationPipe } from "./jd-validation.pipe.js";
import { GoogleWorkspaceJdSyncService } from "./google-workspace-jd-sync.service.js";

@Module({ imports: [AuthModule], controllers: [JobDescriptionController], providers: [JobDescriptionService, GoogleWorkspaceJdSyncService, JdValidationPipe] })
export class ExtensionIngestionModule {}
