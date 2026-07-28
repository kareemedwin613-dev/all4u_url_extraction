import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import type { ApiRequest } from "../types/request.js";
import { JsonLogger } from "./json-logger.service.js";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ApiRequest>(), response = context.switchToHttp().getResponse(), started = performance.now();
    const finish = (error?: { code?: string; fieldErrors?: Record<string,string[]>; getStatus?: () => number }) => this.logger.log("request.completed", { requestId: request.requestId, method: request.method, route: request.originalUrl, statusCode: error?.getStatus?.() || (error ? 500 : response.statusCode), durationMs: Math.round(performance.now() - started), userId: request.user?.id, ...(error ? { errorCode: error.code || "REQUEST_ERROR",...(error.fieldErrors?{validationFields:Object.keys(error.fieldErrors)}:{}) } : {}) });
    return next.handle().pipe(tap({ next: () => finish(), error: (error) => finish(error) }));
  }
}
