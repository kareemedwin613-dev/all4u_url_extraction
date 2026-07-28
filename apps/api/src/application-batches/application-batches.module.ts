import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupabaseModule } from "../supabase/supabase.module.js";
import { ApplicationBatchesController } from "./application-batches.controller.js";
import { ApplicationBatchesRepository } from "./application-batches.repository.js";
import { ApplicationBatchesService } from "./application-batches.service.js";

@Module({ imports: [AuthModule, SupabaseModule], controllers: [ApplicationBatchesController], providers: [ApplicationBatchesRepository, ApplicationBatchesService] })
export class ApplicationBatchesModule {}
