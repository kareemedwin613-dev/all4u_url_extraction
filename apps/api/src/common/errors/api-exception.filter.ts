import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { ApiException } from "./api.exception.js";
import type { ApiRequest } from "../types/request.js";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp(), request = context.getRequest<ApiRequest>(), response = context.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR, code = "INTERNAL_ERROR", message = "An unexpected error occurred.", details: unknown, fieldErrors: Record<string, string[]> | undefined;
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    if (error instanceof ApiException) {
      status = error.getStatus(); code = error.code; message = error.message; details = error.details; fieldErrors = error.fieldErrors;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 429 ? "RATE_LIMITED" : status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "REQUEST_ERROR";
      const body = error.getResponse();
      message = typeof body === "string" ? body : String((body as { message?: unknown }).message || error.message);
    } else if (/request entity too large|PayloadTooLargeError/i.test(rawMessage) || (error as { type?: string; status?: number; statusCode?: number })?.type === "entity.too.large" || (error as { status?: number; statusCode?: number })?.status === 413 || (error as { statusCode?: number })?.statusCode === 413) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      code = "PAYLOAD_TOO_LARGE";
      message = "The request body is too large. Create fewer Applications in one batch.";
    }
    if (status === HttpStatus.INTERNAL_SERVER_ERROR && process.env.NODE_ENV === "test" && error instanceof Error) details = error.message;
    response.status(status).json({ code, message, requestId: request.requestId, ...(details === undefined ? {} : { details }), ...(fieldErrors ? { fieldErrors } : {}) });
  }
}
