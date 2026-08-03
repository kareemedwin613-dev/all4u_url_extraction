import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { ApplicationService } from "./application.service.js";
import { RecordApplicationAutofillTelemetryDto, UpdateApplicationAutofillRecoveryDto } from "./application.dto.js";

@ApiTags("Extension sessions")
@ApiBearerAuth()
@Controller("extension-sessions")
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles("APPLIER", "APPLYING_MANAGER", "ADMIN")
export class AutofillTelemetryController {
  constructor(@Inject(ApplicationService) private readonly service: ApplicationService) {}

  @Patch(":id/autofill-telemetry")
  @ApiOperation({ summary: "Record privacy-safe aggregate and field Autofill outcomes" })
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async record(
    @Req() request: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(RecordApplicationAutofillTelemetryDto)) body: RecordApplicationAutofillTelemetryDto,
  ) {
    return { data: await this.service.recordAutofillTelemetry(request.user!, id, body), requestId: request.requestId };
  }

  @Get(":id/autofill-recovery")
  @ApiOperation({ summary: "Load a non-sensitive Autofill recovery pointer and field outcomes" })
  async recovery(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.service.autofillRecovery(request.user!, id), requestId: request.requestId };
  }

  @Patch(":id/autofill-recovery")
  @ApiOperation({ summary: "Update a non-sensitive Autofill recovery pointer" })
  async updateRecovery(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body(new DtoValidationPipe(UpdateApplicationAutofillRecoveryDto)) body: UpdateApplicationAutofillRecoveryDto) {
    return { data: await this.service.updateAutofillRecovery(request.user!, id, body), requestId: request.requestId };
  }
}

@ApiTags("Autofill reporting")
@ApiBearerAuth()
@Controller("autofill-quality-report")
@UseGuards(AuthGuard,RolesGuard)
@RequireRoles("APPLYING_MANAGER","ADMIN")
export class AutofillQualityReportController{
  constructor(@Inject(ApplicationService)private readonly service:ApplicationService){}
  @Get()@ApiOperation({summary:"Load privacy-safe aggregate Autofill quality metrics"})
  async report(@Req()request:ApiRequest,@Query("days")days?:string){return{data:await this.service.autofillQualityReport(request.user!,Number(days)||30),requestId:request.requestId};}
}
