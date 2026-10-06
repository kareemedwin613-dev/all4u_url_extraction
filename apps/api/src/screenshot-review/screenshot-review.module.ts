import { Body, Controller, Inject, Injectable, Module, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { createClient } from "@supabase/supabase-js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { environment } from "../config/environment.js";
import { ApiException } from "../common/errors/api.exception.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import type { ApiRequest } from "../common/types/request.js";

export class ScreenshotReviewManageDto {
  @IsIn(["create", "list", "detail", "history", "result", "ticket", "retry", "cancel"]) operation!: string;
  @IsOptional() @IsUUID("4") id?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID("4", { each: true }) applicationIds?: string[];
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/) model?: string;
}
export class ScreenshotReviewRunnerDto {
  @IsIn(["next", "submit", "fail"]) operation!: string;
  @IsString() @Matches(/^srb_[A-Za-z0-9_-]{43}$/) ticket!: string;
  @IsOptional() @IsUUID("4") itemId?: string;
  @IsOptional() @IsUUID("4") leaseToken?: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
  @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{1,80}$/) code?: string;
}

@Injectable()
export class ScreenshotReviewService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async call(body: ScreenshotReviewManageDto | ScreenshotReviewRunnerDto, token?: string) {
    const runner = "ticket" in body;
    if ((!runner && body.operation === "create" && (!body.applicationIds?.length || !body.model))
      || (!runner && !["create", "list"].includes(body.operation) && !body.id)
      || (runner && body.operation !== "next" && (!body.itemId || !body.leaseToken))
      || (runner && body.operation === "submit" && !body.result)) {
      throw new ApiException("SCREENSHOT_REVIEW_INVALID", "Required review fields are missing.", 400);
    }
    const { operation, ...payload } = body;
    const client = token ? this.supabase.forUser(token) : this.supabase.anonymous();
    const { data, error } = await client.rpc(runner ? "screenshot_review_runner" : "screenshot_review_manage", {
      p_operation: operation,
      p_body: runner ? { itemId: body.itemId, leaseToken: body.leaseToken, result: body.result, code: body.code } : payload,
      ...(runner ? { p_ticket: body.ticket } : {}),
    });
    if (error) {
      const known = String(error.message).match(/^(SCREENSHOT_REVIEW_[A-Z_]+):\s*(.*)$/);
      const code = known?.[1] || "SCREENSHOT_REVIEW_DATABASE_ERROR";
      throw new ApiException(code, known?.[2] || "Screenshot review is unavailable. Check migrations and retry.",
        error.code === "42501" ? 403 : code.includes("TICKET") ? 410 : code.includes("LEASE") ? 409 : known ? 400 : 502);
    }
    if (runner && operation === "next" && data?.itemId) {
      const env = environment();
      const storage = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_OR_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { "x-screenshot-review-ticket": body.ticket, "x-screenshot-review-item": data.itemId, "x-screenshot-review-lease": data.leaseToken } },
      });
      const screenshots = data.source.screenshots as { id: string; path: string; mimeType: string; bytes: number }[];
      const signed = await storage.storage.from("application-screenshots").createSignedUrls(screenshots.map(s => s.path), 120);
      if (signed.error || !signed.data || screenshots.some(s => !signed.data?.some(url => url.path === s.path && url.signedUrl && !url.error))) {
        // Preserve the claim so a transient storage failure is retried after lease expiry.
        throw new ApiException("SCREENSHOT_REVIEW_STORAGE_UNAVAILABLE", "Private screenshots could not be downloaded. The lease will be retried.", 503);
      }
      data.source.screenshots = screenshots.map(s => ({ id: s.id, mimeType: s.mimeType, bytes: s.bytes, url: signed.data!.find(url => url.path === s.path)!.signedUrl }));
      data.storageOrigin = new URL(env.SUPABASE_URL).origin;
    }
    return data;
  }
}

@Controller("screenshot-review-batches")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLYING_MANAGER", "ADMIN")
export class ScreenshotReviewController {
  constructor(@Inject(ScreenshotReviewService) private readonly service: ScreenshotReviewService) {}
  @Post() @Throttle({ default: { limit: 120, ttl: 60000 } })
  async manage(@Req() req: ApiRequest, @Body(new DtoValidationPipe(ScreenshotReviewManageDto)) body: ScreenshotReviewManageDto) {
    return { data: await this.service.call(body, req.user!.token), requestId: req.requestId };
  }
}
@Controller("screenshot-review-runner")
export class ScreenshotReviewRunnerController {
  constructor(@Inject(ScreenshotReviewService) private readonly service: ScreenshotReviewService) {}
  @Post() @Throttle({ default: { limit: 120, ttl: 60000 } })
  async run(@Req() req: ApiRequest, @Body(new DtoValidationPipe(ScreenshotReviewRunnerDto)) body: ScreenshotReviewRunnerDto) {
    return { data: await this.service.call(body), requestId: req.requestId };
  }
}
@Module({ imports: [AuthModule], controllers: [ScreenshotReviewController, ScreenshotReviewRunnerController], providers: [ScreenshotReviewService] })
export class ScreenshotReviewModule {}
