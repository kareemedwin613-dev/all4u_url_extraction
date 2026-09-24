import { HttpStatus } from "@nestjs/common";
import { ApiException } from "../common/errors/api.exception.js";

export function evaluationArchived(): never {
  throw new ApiException("EVALUATION_ARCHIVED", "AI evaluation is archived. Use category/subcategory matching.", HttpStatus.GONE);
}

export function activeMatchingMode(value?: string): "CATEGORY" {
  if (value && value !== "CATEGORY") evaluationArchived();
  return "CATEGORY";
}
