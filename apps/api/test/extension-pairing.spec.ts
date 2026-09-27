import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionPairingService } from "../src/extension-pairing/extension-pairing.service.js";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", token: "user-jwt", claims: {} };
const pairingId = "223e4567-e89b-42d3-a456-426614174000", challenge = "a".repeat(64), secret = "s".repeat(43);

function serviceWith({ approve, redeem, configured = true, mint }: { approve?: any; redeem?: any; configured?: boolean; mint?: any }) {
  const calls: any[] = [];
  const supabase = {
    forUser: (token: string) => ({ rpc: async (name: string, args: any) => { calls.push({ client: "user", token, name, args }); return name === "approve_extension_pairing_v124" ? approve : { data: 1, error: null }; } }),
    anonymous: () => ({ rpc: async (name: string, args: any) => { calls.push({ client: "anon", name, args }); return redeem; } }),
  };
  const minter = { configured: () => configured, mint: mint || (async () => ({ accessToken: "ext-access", refreshToken: "ext-refresh", expiresAt: 123, userId: user.id })) };
  return { service: new ExtensionPairingService(supabase as any, minter as any), calls };
}

test("approval runs as the signed-in user and requires the server to be configured", async () => {
  const { service, calls } = serviceWith({ approve: { data: { pairingId }, error: null } });
  assert.deepEqual(await service.approve(user, pairingId, challenge), { pairingId });
  assert.deepEqual(calls, [{ client: "user", token: "user-jwt", name: "approve_extension_pairing_v124", args: { p_pairing_id: pairingId, p_challenge: challenge } }]);
  await assert.rejects(() => serviceWith({ configured: false }).service.approve(user, pairingId, challenge), (error: any) => error.code === "EXTENSION_CONNECT_NOT_CONFIGURED" && error.getStatus() === 503);
  await assert.rejects(() => serviceWith({ approve: { data: null, error: { message: "EXTENSION_PAIRING_USED: Already approved." } } }).service.approve(user, pairingId, challenge), (error: any) => error.code === "EXTENSION_PAIRING_USED" && error.getStatus() === 409);
});

test("redeeming waits while pending and never mints a session before approval", async () => {
  let minted = 0;
  const { service, calls } = serviceWith({ redeem: { data: { state: "PENDING" }, error: null }, mint: async () => { minted++; } });
  assert.deepEqual(await service.redeem(pairingId, secret, "1.2.3.4", "agent"), { state: "PENDING" });
  assert.deepEqual(calls, [{ client: "anon", name: "redeem_extension_pairing_v124", args: { p_pairing_id: pairingId, p_secret: secret } }]);
  assert.equal(minted, 0);
  for (const [state, code] of [["EXPIRED", "EXTENSION_PAIRING_EXPIRED"], ["USED", "EXTENSION_PAIRING_USED"]])
    await assert.rejects(() => serviceWith({ redeem: { data: { state }, error: null } }).service.redeem(pairingId, secret, null, ""), (error: any) => error.code === code && error.getStatus() === 410);
  await assert.rejects(() => serviceWith({ redeem: { data: null, error: { message: "EXTENSION_PAIRING_INVALID: The connection request is invalid." } } }).service.redeem(pairingId, secret, null, ""), (error: any) => error.code === "EXTENSION_PAIRING_INVALID");
});

test("an approved pairing mints a session for exactly that user and records an extension login", async () => {
  const minted: any[] = [];
  const { service, calls } = serviceWith({
    redeem: { data: { state: "APPROVED", userId: user.id, email: "applier@example.com" }, error: null },
    mint: async (email: string, userId: string) => { minted.push({ email, userId }); return { accessToken: "ext-access", refreshToken: "ext-refresh", expiresAt: 123, userId }; },
  });
  const result: any = await service.redeem(pairingId, secret, "1.2.3.4", "agent");
  assert.deepEqual(minted, [{ email: "applier@example.com", userId: user.id }]);
  assert.deepEqual(result, { state: "APPROVED", session: { accessToken: "ext-access", refreshToken: "ext-refresh", expiresAt: 123, userId: user.id } });
  assert.deepEqual(calls.at(-1), { client: "user", token: "ext-access", name: "record_user_activity_event_v33", args: { p_event_type: "USER_LOGIN", p_client_type: "EXTENSION", p_ip_address: "1.2.3.4", p_user_agent: "agent" } });
});
