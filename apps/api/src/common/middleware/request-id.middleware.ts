import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { randomUUID } from "node:crypto";
import type { ApiRequest } from "../types/request.js";

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: ApiRequest, response: Response, next: NextFunction) {
    const incoming = request.header("x-request-id") || "";
    request.requestId = VALID_REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID()}`;
    response.setHeader("X-Request-ID", request.requestId);
    next();
  }
}
