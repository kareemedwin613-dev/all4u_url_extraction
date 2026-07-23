export class AppError extends Error {
  constructor(code, message, details = "", retryable = false) {
    super(message); this.name = "AppError"; this.code = code; this.details = details; this.retryable = retryable;
  }
}
export function safeError(error, fallbackCode = "UNEXPECTED_ERROR", fallbackMessage = "The operation could not be completed.") {
  if (error instanceof AppError) return error;
  const detail = typeof error?.message === "string" ? error.message.replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 240) : "";
  return new AppError(fallbackCode, fallbackMessage, detail, /fetch|network|timeout/i.test(detail));
}
