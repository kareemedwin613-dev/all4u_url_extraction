import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

const CODE_MAP: Record<string, { code: string; status: HttpStatus; message: string }> = {
  BULK_JD_LIMIT: { code: "BULK_LIMIT_EXCEEDED", status: HttpStatus.BAD_REQUEST, message: "You can preview up to 100 job descriptions." },
  BULK_COMBINATION_LIMIT: { code: "BULK_LIMIT_EXCEEDED", status: HttpStatus.BAD_REQUEST, message: "You can create up to 2,000 Applications at once." },
  BULK_NO_JDS: { code: "VALIDATION_ERROR", status: HttpStatus.BAD_REQUEST, message: "Select at least one job description." },
  BULK_NO_COMBINATIONS: { code: "NO_ELIGIBLE_COMBINATIONS", status: HttpStatus.BAD_REQUEST, message: "Select at least one eligible combination." },
  IDEMPOTENCY_CONFLICT: { code: "IDEMPOTENCY_CONFLICT", status: HttpStatus.CONFLICT, message: "This idempotency key was already used with a different request." },
  BULK_BATCH_NOT_FOUND: { code: "BATCH_NOT_FOUND", status: HttpStatus.NOT_FOUND, message: "The Application batch was not found." },
};

@Injectable()
export class ApplicationBatchesRepository {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async rpc(user: AuthenticatedUser, name: string, args: Record<string, unknown>, fallback: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc(name, args);
    if (!error) return data;
    const match = String(error.message || "").match(/^([A-Z][A-Z0-9_]+):/), known = match && CODE_MAP[match[1]];
    if (known) throw new ApiException(known.code, known.message, known.status);
    if (error.code === "42501") throw new ApiException("FORBIDDEN", "Applying Manager or Admin access is required.", HttpStatus.FORBIDDEN);
    throw new ApiException("DATABASE_ERROR", fallback, HttpStatus.BAD_GATEWAY);
  }
}
