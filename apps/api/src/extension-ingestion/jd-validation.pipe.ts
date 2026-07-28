import { HttpStatus, Injectable, PipeTransform } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ApiException } from "../common/errors/api.exception.js";
import { CreateJobDescriptionDto } from "./create-job-description.dto.js";

@Injectable()
export class JdValidationPipe implements PipeTransform {
  async transform(value: unknown) {
    const dto = plainToInstance(CreateJobDescriptionDto, value), errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const fieldErrors: Record<string,string[]> = {};
      for (const error of errors) fieldErrors[error.property] = Object.values(error.constraints || {});
      throw new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, fieldErrors);
    }
    return dto;
  }
}
