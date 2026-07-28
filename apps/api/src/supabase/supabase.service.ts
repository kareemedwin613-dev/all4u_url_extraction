import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { environment } from "../config/environment.js";

@Injectable()
export class SupabaseService {
  forUser(token: string): SupabaseClient {
    const env = environment();
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_OR_PUBLISHABLE_KEY, {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async accessContext(token: string): Promise<{ data: unknown; error: null | { code: string; status: number } }> {
    const env = environment();
    try {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_access_context`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_OR_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { data: null, error: { code: String(payload?.code || `HTTP_${response.status}`), status: response.status } };
      return { data: payload, error: null };
    } catch {
      return { data: null, error: { code: "SUPABASE_UNREACHABLE", status: 503 } };
    }
  }

  async readiness(): Promise<void> {
    const env = environment();
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: env.SUPABASE_ANON_OR_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Supabase Auth is unavailable.");
  }
}
