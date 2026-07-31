import {Body,Controller,Delete,Get,Inject,Param,ParseUUIDPipe,Patch,Post,Req,UseGuards} from "@nestjs/common";
import {ApiBearerAuth,ApiOperation,ApiTags} from "@nestjs/swagger";
import {Throttle} from "@nestjs/throttler";
import {AuthGuard} from "../auth/auth.guard.js";
import {RequireRoles} from "../auth/require-roles.decorator.js";
import {RolesGuard} from "../auth/roles.guard.js";
import type {ApiRequest} from "../common/types/request.js";
import {DtoValidationPipe} from "../common/validation/dto-validation.pipe.js";
import {SaveResumeAnswerDto} from "./resume-answer.dto.js";
import {ResumeAnswerService} from "./resume-answer.service.js";

@ApiTags("Resume Answer Library") @ApiBearerAuth() @Controller("resumes/:resumeId/application-answers") @UseGuards(AuthGuard,RolesGuard) @RequireRoles("APPLYING_MANAGER","ADMIN") @Throttle({default:{limit:60,ttl:60000}})
export class ResumeAnswerController{
  constructor(@Inject(ResumeAnswerService)private readonly service:ResumeAnswerService){}
  private response(request:ApiRequest,data:unknown){return{data,requestId:request.requestId};}
  @Get() @ApiOperation({summary:"List reviewed and draft answers owned by one Resume"})
  async list(@Req()request:ApiRequest,@Param("resumeId",new ParseUUIDPipe({version:"4"}))resumeId:string){return this.response(request,await this.service.list(request.user!,resumeId));}
  @Post() @ApiOperation({summary:"Create one explicit Resume application answer"})
  async create(@Req()request:ApiRequest,@Param("resumeId",new ParseUUIDPipe({version:"4"}))resumeId:string,@Body(new DtoValidationPipe(SaveResumeAnswerDto))body:SaveResumeAnswerDto){return this.response(request,await this.service.save(request.user!,resumeId,body));}
  @Patch(":answerId") @ApiOperation({summary:"Update and review one Resume application answer"})
  async update(@Req()request:ApiRequest,@Param("resumeId",new ParseUUIDPipe({version:"4"}))resumeId:string,@Param("answerId",new ParseUUIDPipe({version:"4"}))answerId:string,@Body(new DtoValidationPipe(SaveResumeAnswerDto))body:SaveResumeAnswerDto){return this.response(request,await this.service.save(request.user!,resumeId,body,answerId));}
  @Delete(":answerId") @ApiOperation({summary:"Archive one Resume application answer"})
  async archive(@Req()request:ApiRequest,@Param("resumeId",new ParseUUIDPipe({version:"4"}))resumeId:string,@Param("answerId",new ParseUUIDPipe({version:"4"}))answerId:string){return this.response(request,await this.service.archive(request.user!,resumeId,answerId));}
}
