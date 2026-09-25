import { HttpStatus, Injectable } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { ApiException } from "../common/errors/api.exception.js";
import { environment } from "../config/environment.js";

export interface ExtensionSession { accessToken: string; refreshToken: string; expiresAt: number | null; userId: string; }

// The only use of the Supabase admin key in the API. It creates a one-time sign-in link for a
// user that redeem_extension_pairing_v124 has already verified, and immediately exchanges it
// for a new session that belongs to the extension. The link is never sent or shown to anyone.
@Injectable()
export class ExtensionSessionMinter {
  configured() { return Boolean(environment().SUPABASE_SECRET_KEY); }

  async mint(email: string, expectedUserId: string): Promise<ExtensionSession> {
    const env = environment();
    if (!env.SUPABASE_SECRET_KEY) throw new ApiException("EXTENSION_CONNECT_NOT_CONFIGURED", "Connecting the extension from the dashboard is not configured on this server. Sign in with email and password instead.", HttpStatus.SERVICE_UNAVAILABLE);
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new ApiException("EXTENSION_CONNECT_FAILED", "The extension session could not be created. Click Connect again.", HttpStatus.BAD_GATEWAY);
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_OR_PUBLISHABLE_KEY, options);
    const { data, error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    const session = data?.session;
    if (error || !session?.access_token || !session.refresh_token) throw new ApiException("EXTENSION_CONNECT_FAILED", "The extension session could not be created. Click Connect again.", HttpStatus.BAD_GATEWAY);
    if (session.user?.id !== expectedUserId) throw new ApiException("EXTENSION_CONNECT_FAILED", "The extension session did not match the approving account.", HttpStatus.BAD_GATEWAY);
    return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at ?? null, userId: session.user.id };
  }
}
