import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CandidateController } from "./candidate.controller.js";
import { CandidateService } from "./candidate.service.js";
@Module({ imports: [AuthModule], controllers: [CandidateController], providers: [CandidateService] })
export class CandidateModule {}
