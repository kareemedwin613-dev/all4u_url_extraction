import { Injectable, LoggerService } from "@nestjs/common";
import { environment } from "../../config/environment.js";

const REDACTED_KEYS = /authorization|token|password|secret|key/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[REDACTED]" : redact(item)]));
  return value;
}
@Injectable()
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: unknown) {
    const record = { timestamp: new Date().toISOString(), level, message: typeof message === "string" ? message : redact(message), ...(context ? { context: redact(context) } : {}) };
    const output = JSON.stringify(record);
    if (level === "error") console.error(output); else if (level === "warn") console.warn(output); else console.log(output);
  }
  log(message: unknown, context?: unknown) { this.write("info", message, context); }
  error(message: unknown, trace?: string, context?: unknown) { this.write("error", message, { trace: trace ? "[REDACTED]" : undefined, context }); }
  warn(message: unknown, context?: unknown) { this.write("warn", message, context); }
  debug(message: unknown, context?: unknown) { if (environment().LOG_LEVEL === "debug") this.write("debug", message, context); }
  verbose(message: unknown, context?: unknown) { this.debug(message, context); }
}
