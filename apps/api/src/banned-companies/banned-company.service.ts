import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

function fail(error: any, message: string): never {
  const raw = String(error?.message || "");
  if (error?.code === "42501" || /row-level security|permission denied|FORBIDDEN:/i.test(raw)) {
    throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  }
  const known = raw.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  if (known) throw new ApiException(known[1], known[2], known[1].includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
  throw new ApiException("DATABASE_ERROR", message, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class BannedCompanyService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_global_banned_companies_v3129");
    if (error) fail(error, "Global banned companies could not be loaded.");
    return data || [];
  }

  async add(user: AuthenticatedUser, companyName: string, description: string) {
    const name = String(companyName || "").replace(/\s+/g, " ").trim();
    const reason = String(description || "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 200) throw new ApiException("VALIDATION_ERROR", "Enter a company name between 1 and 200 characters.", HttpStatus.BAD_REQUEST);
    if (!reason || reason.length > 500) throw new ApiException("VALIDATION_ERROR", "Enter why this company is banned, using 1 to 500 characters.", HttpStatus.BAD_REQUEST);
    const { data, error } = await this.supabase.forUser(user.token).rpc("add_global_banned_company_v3130", {
      p_company_name: name,
      p_description: reason,
    });
    if (error) fail(error, "The banned company could not be added.");
    return data;
  }

  async updateDescription(user: AuthenticatedUser, id: string, description: string) {
    const reason = String(description || "").replace(/\s+/g, " ").trim();
    if (!reason || reason.length > 500) throw new ApiException("VALIDATION_ERROR", "Enter why this company is banned, using 1 to 500 characters.", HttpStatus.BAD_REQUEST);
    const { data, error } = await this.supabase.forUser(user.token).rpc("update_global_banned_company_v3130", {
      p_id: id,
      p_description: reason,
    });
    if (error) fail(error, "The banned company description could not be saved.");
    return data;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("remove_global_banned_company_v3129", { p_id: id });
    if (error) fail(error, "The banned company could not be removed.");
    return data;
  }
}
