import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

const errors: Record<string, [number, string]> = {
  MATCH_TICKET_INVALID: [403, "The scoring command is invalid or revoked. Generate a new command."],
  MATCH_TICKET_EXPIRED: [410, "The scoring command expired. Generate a new command."],
  MATCH_TICKET_SCOPE: [403, "This scoring command cannot access that document."],
  MATCH_WORKER_VERSION_MISMATCH: [409, "Scoring configuration changed or the worker is out of date. Generate a new command."],
  MATCH_LEASE_EXPIRED: [409, "This scoring job lease expired or changed."],
  MATCH_INVALID_REQUEST: [400, "The scoring runner request is invalid."],
  MATCH_INVALID_RESULT: [400, "The scoring output failed validation."],
};
@Injectable()
export class ApplicationMatchRunnerService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  async call(operation: string, body: { ticket: string; [key: string]: unknown }) {
    if (!["claim", "next", "document", "document-result", "result", "failure"].includes(operation)) {
      throw new ApiException("VALIDATION_ERROR", "Unknown scoring operation.", HttpStatus.BAD_REQUEST);
    }
    const { ticket, ...payload } = body;
    if (JSON.stringify(payload).length > 160_000) throw new ApiException("VALIDATION_ERROR", "Scoring payload is too large.", HttpStatus.BAD_REQUEST);
    const { data, error } = await this.supabase.anonymous().rpc("application_match_runner_call", { p_ticket: ticket, p_operation: operation, p_payload: payload });
    if (error) {
      if (error.code === "PGRST202") throw new ApiException("DATABASE_MIGRATION_REQUIRED", "Apply the scoring runner migration.", HttpStatus.SERVICE_UNAVAILABLE);
      const code = String(error.message || "").match(/^([A-Z][A-Z0-9_]+):/)?.[1];
      if (code && errors[code]) throw new ApiException(code, errors[code][1], errors[code][0]);
      throw new ApiException("MATCH_RUNNER_DATABASE_ERROR", "The scoring runner request could not be completed.", HttpStatus.BAD_GATEWAY);
    }
    return data;
  }
}
