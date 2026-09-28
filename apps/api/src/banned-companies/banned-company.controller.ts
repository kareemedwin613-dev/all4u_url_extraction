import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequireRoles } from "../auth/require-roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/types/request.js";
import { DtoValidationPipe } from "../common/validation/dto-validation.pipe.js";
import { GlobalBannedCompanyDto, UpdateGlobalBannedCompanyDto } from "./banned-company.dto.js";
import { BannedCompanyService } from "./banned-company.service.js";

const READERS = ["JD_FINDER", "APPLYING_MANAGER", "ADMIN"] as const;
const MANAGERS = ["APPLYING_MANAGER", "ADMIN"] as const;

@ApiTags("Banned companies")
@ApiBearerAuth()
@Controller("banned-companies")
@UseGuards(AuthGuard, RolesGuard)
export class BannedCompanyController {
  constructor(@Inject(BannedCompanyService) private readonly bannedCompanies: BannedCompanyService) {}

  @Get()
  @RequireRoles(...READERS)
  @ApiOperation({ summary: "List global banned companies" })
  async list(@Req() request: ApiRequest) {
    return { data: await this.bannedCompanies.list(request.user!), requestId: request.requestId };
  }

  @Post()
  @RequireRoles(...MANAGERS)
  @ApiOperation({ summary: "Add a global banned company" })
  async add(@Req() request: ApiRequest, @Body(new DtoValidationPipe(GlobalBannedCompanyDto)) body: GlobalBannedCompanyDto) {
    return { data: await this.bannedCompanies.add(request.user!, body.companyName, body.description), requestId: request.requestId };
  }

  @Patch(":id")
  @RequireRoles(...MANAGERS)
  @ApiOperation({ summary: "Update why a global banned company is banned" })
  async update(
    @Req() request: ApiRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(UpdateGlobalBannedCompanyDto)) body: UpdateGlobalBannedCompanyDto,
  ) {
    return { data: await this.bannedCompanies.updateDescription(request.user!, id, body.description), requestId: request.requestId };
  }

  @Delete(":id")
  @RequireRoles(...MANAGERS)
  @ApiOperation({ summary: "Remove a global banned company" })
  async remove(@Req() request: ApiRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return { data: await this.bannedCompanies.remove(request.user!, id), requestId: request.requestId };
  }
}
