import { Controller, Get, HttpStatus, Inject } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { HealthResponse } from "@resume-jd/contracts";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ApiException } from "../common/errors/api.exception.js";
import { RENDERED_SKILL_LIMIT } from "../platform/tailored-resume-layout.js";

@ApiTags("Health")
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  @Get("health")
  @ApiOperation({ summary: "Liveness probe" })
  @ApiResponse({ status: 200 })
  health(): HealthResponse & {buildCommit:string|null;tailoring:{renderedSkillLimit:number;educationLayoutVersion:number;keywordCoverageVersion:number}} {
    const commit=process.env.VERCEL_GIT_COMMIT_SHA||"";
    return {status:"ok",service:"resume-platform-api",version:"0.7.2",buildCommit:/^[a-f0-9]{40}$/i.test(commit)?commit:null,
      tailoring:{renderedSkillLimit:RENDERED_SKILL_LIMIT,educationLayoutVersion:2,keywordCoverageVersion:1}};
  }
  @Get("ready")
  @ApiOperation({ summary: "Supabase dependency readiness probe" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 503 })
  async ready() {
    try { await this.supabase.readiness(); return { ...this.health(), dependencies: { supabase: "ready" } }; }
    catch { throw new ApiException("DEPENDENCY_UNAVAILABLE", "A required dependency is unavailable.", HttpStatus.SERVICE_UNAVAILABLE); }
  }
}
