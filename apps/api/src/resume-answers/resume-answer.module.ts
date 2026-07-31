import {Module} from "@nestjs/common";
import {AuthModule} from "../auth/auth.module.js";
import {ResumeAnswerController} from "./resume-answer.controller.js";
import {ResumeAnswerService} from "./resume-answer.service.js";
@Module({imports:[AuthModule],controllers:[ResumeAnswerController],providers:[ResumeAnswerService]})
export class ResumeAnswerModule{}
