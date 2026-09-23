import { Body, Controller, Inject, Injectable, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ApiException } from "../common/errors/api.exception.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import type { ApiRequest } from "../common/types/request.js";

export class JdReviewManageDto {
  @IsIn(["create", "list", "detail", "ticket", "retry", "cancel"]) operation!: string;
  @IsOptional() @IsUUID("4") id?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID("4", { each: true }) jobDescriptionIds?: string[];
}
export class JdReviewRunnerDto {
  @IsIn(["next", "submit"]) operation!: string;
  @IsString() @Matches(/^jrb_[A-Za-z0-9_-]{43}$/) ticket!: string;
  @IsOptional() @IsUUID("4") itemId?: string;
  @IsOptional() @IsUUID("4") leaseToken?: string;
  @IsOptional() @IsObject() result?: Record<string, unknown>;
}

@Injectable()
export class JdReviewService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async call(body: JdReviewManageDto | JdReviewRunnerDto, token?: string) {
    const runner = "ticket" in body;
    if ((!runner && body.operation === "create" && !(body as JdReviewManageDto).jobDescriptionIds?.length)
      || (!runner && !["create", "list"].includes(body.operation) && !(body as JdReviewManageDto).id)
      || (runner && body.operation === "submit" && (!body.itemId || !body.leaseToken || !body.result))) {
      throw new ApiException("JD_REVIEW_INVALID", "Required review fields are missing.", 400);
    }
    const client = token ? this.supabase.forUser(token) : this.supabase.anonymous();
    const { operation, ...payload } = body;
    const { data, error } = await client.rpc(runner ? "jd_review_runner" : "jd_review_manage", {
      p_operation: operation,
      p_body: runner ? { itemId: body.itemId, leaseToken: body.leaseToken, result: body.result } : payload,
      ...(runner ? { p_ticket: body.ticket } : {}),
    });
    if (error) {
      const known = String(error.message).match(/^(JD_REVIEW_[A-Z_]+):\s*(.*)$/);
      const code = known?.[1] || "JD_REVIEW_DATABASE_ERROR";
      throw new ApiException(code, known?.[2] || "JD review could not be saved. Check migrations and retry.",
        error.code === "42501" ? 403 : code.includes("TICKET") ? 410 : code.includes("LEASE") ? 409 : known ? 400 : 502);
    }
    return data;
  }
}

@Controller("jd-review-batches")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLYING_MANAGER", "ADMIN")
export class JdReviewController {
  constructor(@Inject(JdReviewService) private readonly service: JdReviewService) {}
  @Post() @Throttle({ default: { limit: 120, ttl: 60000 } })
  async manage(@Req() req: ApiRequest, @Body(new DtoValidationPipe(JdReviewManageDto)) body: JdReviewManageDto) {
    return { data: await this.service.call(body, req.user!.token), requestId: req.requestId };
  }
}

@Controller("jd-review-runner")
export class JdReviewRunnerController {
  constructor(@Inject(JdReviewService) private readonly service: JdReviewService) {}
  @Post() @Throttle({ default: { limit: 120, ttl: 60000 } })
  async run(@Req() req: ApiRequest, @Body(new DtoValidationPipe(JdReviewRunnerDto)) body: JdReviewRunnerDto) {
    return { data: await this.service.call(body), requestId: req.requestId };
  }
}
