import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { environment } from "../config/environment.js";

type AccessContextResult = { data: unknown; error: null | { code: string; status: number } };
const ACCESS_CONTEXT_CACHE_TTL_MS = 30_000;
const ACCESS_CONTEXT_CACHE_MAX_ENTRIES = 1_000;

@Injectable()
export class SupabaseService {
  private readonly accessContextCache = new Map<string, { expiresAt: number; value: AccessContextResult }>();
  private readonly accessContextInFlight = new Map<string, Promise<AccessContextResult>>();

  anonymous(): SupabaseClient {
    const env = environment();
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_OR_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  forUser(token: string): SupabaseClient {
    const env = environment();
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_OR_PUBLISHABLE_KEY, {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async accessContext(token: string): Promise<AccessContextResult> {
    const key = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const cached = this.accessContextCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.accessContextCache.delete(key);
    const existing = this.accessContextInFlight.get(key);
    if (existing) return existing;
    const pending = this.loadAccessContext(token).then((value) => {
      if (!value.error) {
        if (this.accessContextCache.size >= ACCESS_CONTEXT_CACHE_MAX_ENTRIES) {
          const oldestKey = this.accessContextCache.keys().next().value;
          if (oldestKey) this.accessContextCache.delete(oldestKey);
        }
        this.accessContextCache.set(key, { expiresAt: Date.now() + ACCESS_CONTEXT_CACHE_TTL_MS, value });
      }
      return value;
    }).finally(() => this.accessContextInFlight.delete(key));
    this.accessContextInFlight.set(key, pending);
    return pending;
  }

  private async loadAccessContext(token: string): Promise<AccessContextResult> {
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
