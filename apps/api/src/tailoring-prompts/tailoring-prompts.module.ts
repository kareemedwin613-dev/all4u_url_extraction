import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupabaseModule } from "../supabase/supabase.module.js";
import { TailoringPromptsController, TailoringPromptTestRunnerController } from "./tailoring-prompts.controller.js";
import { TailoringPromptsService } from "./tailoring-prompts.service.js";

@Module({ imports: [AuthModule, SupabaseModule], controllers: [TailoringPromptsController, TailoringPromptTestRunnerController], providers: [TailoringPromptsService] })
export class TailoringPromptsModule {}
