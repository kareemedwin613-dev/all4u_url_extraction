import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { environment } from "./config/environment.js";
import { SupabaseModule } from "./supabase/supabase.module.js";
import { HealthModule } from "./health/health.module.js";
import { ExtensionIngestionModule } from "./extension-ingestion/extension-ingestion.module.js";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware.js";
import { JsonLogger } from "./common/logging/json-logger.service.js";
import { RequestLoggingInterceptor } from "./common/logging/request-logging.interceptor.js";
import { JobDescriptionReadModule } from "./job-descriptions/job-description-read.module.js";
import { LookupModule } from "./lookups/lookup.module.js";
import { ResumeModule } from "./resumes/resume.module.js";
import { ApplicationModule } from "./applications/application.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { ApplicationBatchesModule } from "./application-batches/application-batches.module.js";
import { BulkAssignmentModule } from "./bulk-assignment/bulk-assignment.module.js";
import { CandidateModule } from "./candidates/candidate.module.js";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: environment().RATE_LIMIT_TTL_MS, limit: environment().RATE_LIMIT_MAX }]),
    SupabaseModule,
    HealthModule,
    ExtensionIngestionModule,
    JobDescriptionReadModule,
    LookupModule,
    ResumeModule,
    ApplicationModule,
    PlatformModule,
    ApplicationBatchesModule,
    BulkAssignmentModule,
    CandidateModule,
  ],
  providers: [
    JsonLogger,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(RequestIdMiddleware).forRoutes("*"); }
}
