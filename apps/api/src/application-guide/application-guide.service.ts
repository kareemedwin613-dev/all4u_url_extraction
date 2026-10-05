import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { SaveApplicationGuideDto } from "./application-guide.dto.js";

function fail(error: any, message: string): never {
  const raw = String(error?.message || "");
  if (error?.code === "PGRST202") {
    throw new ApiException("DATABASE_MIGRATION_REQUIRED", "The Application Guide is not available yet.", HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (error?.code === "42501" || /row-level security|permission denied|FORBIDDEN:/i.test(raw)) {
    throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  }
  const known = raw.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  if (known) throw new ApiException(known[1], known[2], known[1].includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
  throw new ApiException("DATABASE_ERROR", message, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class ApplicationGuideService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_application_guide_v3149");
    if (error) fail(error, "The Application Guide could not be loaded.");
    return data || [];
  }

  async save(user: AuthenticatedUser, body: SaveApplicationGuideDto) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("save_application_guide_v3149", {
      p_id: body.id || null,
      p_question: body.question,
      p_meaning: body.meaning,
      p_how_to_answer: body.howToAnswer,
      p_example: body.exampleAnswer || "",
      p_status: body.status,
    });
    if (error) fail(error, "The guide entry could not be saved.");
    return data;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("delete_application_guide_v3149", { p_id: id });
    if (error) fail(error, "The guide entry could not be removed.");
    return data;
  }
}
