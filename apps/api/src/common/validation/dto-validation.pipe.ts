import { HttpStatus, type PipeTransform } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ApiException } from "../errors/api.exception.js";

type DtoClass<T extends object> = new () => T;

export class DtoValidationPipe<T extends object> implements PipeTransform {
  constructor(private readonly dtoClass: DtoClass<T>) {}
  async transform(value: unknown) {
    const dto = plainToInstance(this.dtoClass, value ?? {}), errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false });
    if (errors.length) {
      const fieldErrors: Record<string, string[]> = {};
      for (const error of errors) fieldErrors[error.property] = Object.values(error.constraints || {});
      throw new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, fieldErrors);
    }
    return dto;
  }
}
