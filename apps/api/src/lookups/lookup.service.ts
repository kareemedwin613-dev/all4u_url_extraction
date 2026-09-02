import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

function fail(error: any, message: string): never {
  if (error?.code === "42501" || /row-level security|permission denied/i.test(String(error?.message || ""))) throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  throw new ApiException("DATABASE_ERROR", message, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class LookupService {
  private readonly cache = new Map<string, { expiresAt: number; rows: any[] }>();
  private readonly inFlight = new Map<string, Promise<any[]>>();

  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  private async cached(key: string, loader: () => Promise<any[]>): Promise<any[]> {
    const value = this.cache.get(key);
    if (value && value.expiresAt > Date.now()) return value.rows;
    if (value) this.cache.delete(key);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = loader().then((rows) => {
      this.cache.set(key, { expiresAt: Date.now() + 5 * 60_000, rows });
      return rows;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  async categories(user: AuthenticatedUser) {
    return this.cached("categories", async () => {
      const { data, error } = await this.supabase.forUser(user.token).from("categories").select("id,slug,name,parent_id,sort_order,active").eq("active", true).order("sort_order");
      if (error) fail(error, "Categories could not be loaded.");
      return data || [];
    });
  }

  async industryDomains(user: AuthenticatedUser) {
    return this.cached("industry-domains", async () => {
      const { data, error } = await this.supabase.forUser(user.token).from("industry_domain_categories").select("id,slug,name,description,sort_order").eq("active", true).order("sort_order").order("name");
      if (error) fail(error, "Industry domains could not be loaded.");
      return data || [];
    });
  }
}
