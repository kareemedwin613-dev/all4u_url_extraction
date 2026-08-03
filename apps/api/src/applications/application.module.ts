import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupabaseModule } from "../supabase/supabase.module.js";
import { ApplicationController, ExtensionSessionController } from "./application.controller.js";
import { AutofillQualityReportController, AutofillTelemetryController } from "./autofill-telemetry.controller.js";
import { ApplicationService } from "./application.service.js";

@Module({
  imports: [AuthModule, SupabaseModule],
  controllers: [ApplicationController, ExtensionSessionController, AutofillTelemetryController, AutofillQualityReportController],
  providers: [ApplicationService],
  exports: [ApplicationService],
})
export class ApplicationModule {}
