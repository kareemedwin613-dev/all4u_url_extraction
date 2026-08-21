import { HttpStatus, type PipeTransform } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate, type ValidationError } from "class-validator";
import { ApiException } from "../errors/api.exception.js";

type DtoClass<T extends object> = new () => T;

function collectFieldErrors(errors: ValidationError[], prefix = "", target: Record<string, string[]> = {}) {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const messages = Object.values(error.constraints || {});
    if (messages.length) target[path] = [...(target[path] || []), ...messages];
    if (error.children?.length) collectFieldErrors(error.children, path, target);
  }
  return target;
}

export class DtoValidationPipe<T extends object> implements PipeTransform {
  constructor(private readonly dtoClass: DtoClass<T>) {}
  async transform(value: unknown) {
    const dto = plainToInstance(this.dtoClass, value ?? {}), errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false });
    if (errors.length) {
      throw new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, collectFieldErrors(errors));
    }
    return dto;
  }
}
