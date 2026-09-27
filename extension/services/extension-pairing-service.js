import { AppError } from "../shared/errors.js";

// "Connect with dashboard": the extension keeps a random secret and shows the dashboard only its
// SHA-256 (the challenge). After the signed-in user approves the matching confirmation code, the
// extension proves it holds the secret and receives its own session. Pairings last 5 minutes.
export const PAIRING_TIMEOUT_MS = 5 * 60 * 1000, PAIRING_POLL_MS = 2000;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export function confirmationCode(challenge) {
  const value = String(challenge || "").toUpperCase();
  return `${value.slice(0, 3)}-${value.slice(3, 6)}`;
}

export async function createPairing(cryptoImpl = globalThis.crypto) {
  const secret = base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const challenge = hex(await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return { pairingId: cryptoImpl.randomUUID(), secret, challenge, code: confirmationCode(challenge) };
}

export function pairingUrl(dashboardUrl, { pairingId, challenge }) {
  const origin = new URL(String(dashboardUrl || "")).origin;
  return `${origin}/#/connect-extension?pairing=${encodeURIComponent(pairingId)}&challenge=${encodeURIComponent(challenge)}`;
}

// No session exists yet, so this is the one extension call without a Bearer token.
export async function redeemPairing(baseUrl, { pairingId, secret }, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${String(baseUrl || "").replace(/\/+$/, "")}/api/v1/extension-pairings/redeem`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairingId, secret }), signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { state: "PENDING" };
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429 || response.status >= 500 && response.status !== 503) return { state: "PENDING" };
  if (!response.ok) throw new AppError(payload.code || "EXTENSION_CONNECT_FAILED", payload.message || "The extension could not be connected.");
  return payload.data || { state: "PENDING" };
}

export async function waitForApproval(baseUrl, pairing, { signal, redeem = redeemPairing, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const deadline = now() + PAIRING_TIMEOUT_MS;
  while (now() < deadline) {
    if (signal?.aborted) throw new AppError("EXTENSION_CONNECT_CANCELLED", "Connecting was cancelled.");
    const result = await redeem(baseUrl, pairing);
    if (result?.state === "APPROVED") {
      const session = result.session;
      if (!session?.accessToken || !session?.refreshToken) throw new AppError("EXTENSION_CONNECT_FAILED", "The dashboard returned an incomplete session.");
      return session;
    }
    await sleep(PAIRING_POLL_MS);
  }
  throw new AppError("EXTENSION_PAIRING_EXPIRED", "The connection request expired. Click Connect with dashboard again.");
}
