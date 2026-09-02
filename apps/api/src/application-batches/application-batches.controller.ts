import { Body, Controller, Get, Headers, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { ApplicationBatchesService } from "./application-batches.service.js";
import { BulkApplicationBatchDeleteDto } from "./bulk-application-batch-delete.dto.js";
import { BatchListQueryDto, BatchResultsQueryDto, BulkCreateDto, BulkPreviewDto } from "./application-batches.dto.js";

const MANAGERS = ["APPLYING_MANAGER", "ADMIN"] as const;
@ApiTags("Bulk Applications and batches") @ApiBearerAuth() @Controller() @UseGuards(AuthGuard, RolesGuard) @RequireRoles(...MANAGERS)
export class ApplicationBatchesController {
  constructor(@Inject(ApplicationBatchesService) private readonly service: ApplicationBatchesService) {}
  private response(request: ApiRequest, data: unknown, page?: unknown) { return { data, ...(page ? { page } : {}), requestId: request.requestId }; }

  @Post("applications/bulk-preview") @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @ApiOperation({ summary: "Preview eligible JD and active Resume combinations without writing data" })
  @ApiResponse({ status: 201, description: "Set-based preview" })
  async preview(@Req() request: ApiRequest, @Body(new DtoValidationPipe(BulkPreviewDto)) body: BulkPreviewDto) { return this.response(request, await this.service.preview(request.user!, body, request.requestId)); }

  @Post("applications/bulk-create") @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "8â€“200 safe characters; reuse after an uncertain failure" })
  @ApiOperation({ summary: "Create reviewed Application combinations in one idempotent database call" })
  async create(@Req() request: ApiRequest, @Headers("idempotency-key") key: string | undefined, @Body(new DtoValidationPipe(BulkCreateDto)) body: BulkCreateDto) {
    if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new ApiException("VALIDATION_ERROR", "A valid Idempotency-Key header is required.", HttpStatus.BAD_REQUEST, undefined, { idempotencyKey: ["Use 8â€“200 letters, numbers, dots, underscores, colons, or hyphens."] });
    return this.response(request, await this.service.create(request.user!, body, key, request.requestId));
  }

  @Get("application-batches") @ApiOperation({ summary: "List creation batches with bounded pagination" })
  async list(@Req() request: ApiRequest, @Query(new DtoValidationPipe(BatchListQueryDto)) query: BatchListQueryDto) { const data = await this.service.list(request.user!, query); return this.response(request, data, { nextCursor: data.nextCursor, pageSize: data.pageSize, total: data.total }); }
  @Get("application-batches/options") async options(@Req() request: ApiRequest) { return this.response(request, await this.service.options(request.user!)); }
  @Get("application-batches/:id") @ApiOperation({ summary: "Get one batch summary without row outcomes" })
  async detail(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.response(request, await this.service.detail(request.user!, id)); }
  @Get("application-batches/:id/results") @ApiOperation({ summary: "Get filtered, paginated batch row outcomes" })
  async results(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Query(new DtoValidationPipe(BatchResultsQueryDto)) query: BatchResultsQueryDto) { return this.response(request, await this.service.results(request.user!, id, query)); }

  @Post("application-batches/bulk-delete") @ApiOperation({ summary: "Permanently delete batches whose Applications are all cancelled" })
  async bulkDelete(@Req() request: ApiRequest, @Body(new DtoValidationPipe(BulkApplicationBatchDeleteDto)) body: BulkApplicationBatchDeleteDto) {
    return this.response(request, await this.service.bulkDelete(request.user!, body.batchIds));
  }
}
