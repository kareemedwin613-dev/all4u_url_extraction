import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

function failure(error: any, fallback: string): never {
  const raw = String(error?.message || "");
  const known = raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
  const code =
    known?.[1] ||
    (error?.code === "42501" ? "ACCESS_DENIED" : "DATABASE_ERROR");
  throw new ApiException(
    code,
    known?.[2] || fallback,
    error?.code === "42501" || code.includes("ACCESS") ? 403 : 502,
  );
}

@Injectable()
export class SessionEventsService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async recordLogin(
    user: AuthenticatedUser,
    clientType: "DASHBOARD" | "EXTENSION",
    ipAddress: string | null,
    userAgent: string,
  ) {
    const { data, error } = await this.supabase.forUser(user.token).rpc(
      "record_user_activity_event_v33",
      {
        p_event_type: "USER_LOGIN",
        p_client_type: clientType,
        p_ip_address: ipAddress,
        p_user_agent: userAgent || null,
      },
    );
    if (error) failure(error, "The login event could not be recorded.");
    return { id: data };
  }
}
