import { HttpException, HttpStatus } from "@nestjs/common";

export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
    public readonly fieldErrors?: Record<string, string[]>,
    // Server-side diagnostics (for example the PostgREST error). Logged, never sent to the client.
    public readonly diagnostic?: unknown,
  ) {
    super(message, status);
  }
}
