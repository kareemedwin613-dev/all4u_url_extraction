import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { AutofillAiController, AutofillAiUsageController } from "./autofill-ai.controller.js";
import { AutofillAiService } from "./autofill-ai.service.js";

@Module({
  imports: [AuthModule],
  controllers: [AutofillAiController, AutofillAiUsageController],
  providers: [{ provide: AutofillAiService, useFactory: (supabase: SupabaseService) => new AutofillAiService(supabase), inject: [SupabaseService] }],
})
export class AutofillAiModule {}
