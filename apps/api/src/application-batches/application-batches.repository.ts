import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

const CODE_MAP: Record<string, { code: string; status: HttpStatus; message: string }> = {
  MATCH_INVALID_REQUEST: { code: "VALIDATION_ERROR", status: HttpStatus.BAD_REQUEST, message: "Select at most 1000 JDs and 5000 JD/Resume pairs." },
  MATCHING_NOT_CONFIGURED: { code: "MATCHING_NOT_CONFIGURED", status: HttpStatus.SERVICE_UNAVAILABLE, message: "Configure the scoring model and background worker before requesting scores." },
  BULK_JD_LIMIT: { code: "BULK_LIMIT_EXCEEDED", status: HttpStatus.BAD_REQUEST, message: "You can preview up to 1000 job descriptions." },
  BULK_COMBINATION_LIMIT: { code: "BULK_LIMIT_EXCEEDED", status: HttpStatus.BAD_REQUEST, message: "You can create up to 5,000 Applications at once." },
  BULK_NO_JDS: { code: "VALIDATION_ERROR", status: HttpStatus.BAD_REQUEST, message: "Select at least one job description." },
  BULK_NO_COMBINATIONS: { code: "NO_ELIGIBLE_COMBINATIONS", status: HttpStatus.BAD_REQUEST, message: "Select at least one eligible combination." },
  IDEMPOTENCY_CONFLICT: { code: "IDEMPOTENCY_CONFLICT", status: HttpStatus.CONFLICT, message: "This idempotency key was already used with a different request." },
  BULK_BATCH_NOT_FOUND: { code: "BATCH_NOT_FOUND", status: HttpStatus.NOT_FOUND, message: "The Application batch was not found." },
  BATCH_DELETE_INVALID: { code: "VALIDATION_ERROR", status: HttpStatus.BAD_REQUEST, message: "Select at least one Application batch." },
  BATCH_STILL_PROCESSING: { code: "BATCH_STILL_PROCESSING", status: HttpStatus.CONFLICT, message: "This batch is still processing and cannot be deleted yet." },
  BATCH_HAS_ACTIVE_APPLICATIONS: { code: "BATCH_HAS_ACTIVE_APPLICATIONS", status: HttpStatus.CONFLICT, message: "Cancel every Application in the batch before deleting it." },
};

@Injectable()
export class ApplicationBatchesRepository {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async rpc(user: AuthenticatedUser, name: string, args: Record<string, unknown>, fallback: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc(name, args);
    if (!error) return data;
    if (error.code === "PGRST202") throw new ApiException("DATABASE_MIGRATION_REQUIRED", "Apply the matching database migrations through v3.77 before using this matching method.", HttpStatus.SERVICE_UNAVAILABLE);
    // Preserve only the machine-readable diagnostic, never SQL/source text or RPC arguments.
    const databaseCode = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code || "") ? error.code : "UNKNOWN";
    const details = { databaseCode };
    if (["57014", "55P03", "PGRST003"].includes(databaseCode)) throw new ApiException("DATABASE_TIMEOUT", "The database request timed out. Please retry shortly.", HttpStatus.GATEWAY_TIMEOUT, details);
    if (/^08/.test(databaseCode) || ["53300", "57P01", "57P02", "57P03", "PGRST000", "PGRST001", "PGRST002"].includes(databaseCode)
      || (databaseCode === "UNKNOWN" && /fetch failed|failed to fetch|network|ECONNRESET|ETIMEDOUT/i.test(String(error.message || "")))) {
      throw new ApiException("DATABASE_UNAVAILABLE", "The database connection was temporarily unavailable. Please retry shortly.", HttpStatus.SERVICE_UNAVAILABLE, details);
    }
    const match = String(error.message || "").match(/^([A-Z][A-Z0-9_]+):/), known = match && CODE_MAP[match[1]];
    if (known) throw new ApiException(known.code, known.message, known.status);
    if (error.code === "42501") throw new ApiException("FORBIDDEN", "Applying Manager or Admin access is required.", HttpStatus.FORBIDDEN);
    throw new ApiException("DATABASE_ERROR", fallback, HttpStatus.BAD_GATEWAY, details);
  }
}
