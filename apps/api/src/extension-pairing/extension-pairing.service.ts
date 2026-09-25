import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ExtensionSessionMinter } from "./extension-session-minter.js";

function failure(error: any, fallback: string): never {
  const known = /^([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(String(error?.message || ""));
  const code = known?.[1] || (error?.code === "42501" ? "EXTENSION_PAIRING_FORBIDDEN" : "DATABASE_ERROR");
  const status = code.endsWith("FORBIDDEN") || error?.code === "42501" ? HttpStatus.FORBIDDEN
    : code.endsWith("USED") ? HttpStatus.CONFLICT : known ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
  throw new ApiException(code, known?.[2] || fallback, status);
}

@Injectable()
export class ExtensionPairingService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService, @Inject(ExtensionSessionMinter) private readonly minter: ExtensionSessionMinter) {}

  // Dashboard: the signed-in caller approves the extension showing the same confirmation code.
  async approve(user: AuthenticatedUser, pairingId: string, challenge: string) {
    if (!this.minter.configured()) throw new ApiException("EXTENSION_CONNECT_NOT_CONFIGURED", "Connecting the extension from the dashboard is not configured on this server. Sign in with email and password in the extension instead.", HttpStatus.SERVICE_UNAVAILABLE);
    const { data, error } = await this.supabase.forUser(user.token).rpc("approve_extension_pairing_v124", { p_pairing_id: pairingId, p_challenge: challenge });
    if (error) failure(error, "The extension could not be approved.");
    return data;
  }

  // Extension: proves it holds the secret. Returns PENDING until approved, then a new session once.
  async redeem(pairingId: string, secret: string, ipAddress: string | null, userAgent: string) {
    const { data, error } = await this.supabase.anonymous().rpc("redeem_extension_pairing_v124", { p_pairing_id: pairingId, p_secret: secret });
    if (error) failure(error, "The extension connection could not be checked.");
    const state = String(data?.state || "");
    if (state === "PENDING") return { state };
    if (state === "EXPIRED") throw new ApiException("EXTENSION_PAIRING_EXPIRED", "The connection request expired. Click Connect in the extension again.", HttpStatus.GONE);
    if (state === "USED") throw new ApiException("EXTENSION_PAIRING_USED", "This connection request was already used. Click Connect in the extension again.", HttpStatus.GONE);
    if (state !== "APPROVED" || typeof data?.email !== "string" || typeof data?.userId !== "string") throw new ApiException("EXTENSION_PAIRING_INVALID", "The extension connection response was invalid.", HttpStatus.BAD_GATEWAY);
    const session = await this.minter.mint(data.email, data.userId);
    // Same audit trail as a password sign-in from the extension; never blocks the connection.
    await this.supabase.forUser(session.accessToken).rpc("record_user_activity_event_v33", { p_event_type: "USER_LOGIN", p_client_type: "EXTENSION", p_ip_address: ipAddress, p_user_agent: userAgent || null }).then(() => undefined, () => undefined);
    return { state, session };
  }
}
