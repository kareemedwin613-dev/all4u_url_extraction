import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BannedCompanyController } from "./banned-company.controller.js";
import { BannedCompanyService } from "./banned-company.service.js";

@Module({ imports: [AuthModule], controllers: [BannedCompanyController], providers: [BannedCompanyService] })
export class BannedCompanyModule {}
