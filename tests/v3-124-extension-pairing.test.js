import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { confirmationCode, createPairing, pairingUrl, redeemPairing, waitForApproval } from "../extension/services/extension-pairing-service.js";
import { loadConfig } from "../extension/services/supabase-client.js";
import { BUILT_IN_CONFIG } from "../extension/config/defaults.js";
import { parseConnectRequest } from "../dashboard/src/features/extension-connect/connect-extension-request.js";
import { parseRoute, rememberReturnRoute, takeReturnRoute } from "../dashboard/src/router.js";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha = value => createHash("sha256").update(value).digest("hex");
const secret = "s".repeat(43), challenge = sha(secret);

test("pairings are approved by an active user with a role, redeemed once with the secret, and expire", async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function is_active_user(uuid) returns boolean language sql stable as $$ select $1::text<>'${id(3)}' $$;
    create table roles(id uuid primary key,code text,active boolean);
    create table user_roles(user_id uuid,role_id uuid);
    insert into auth.users values('${id(1)}','applier@example.com'),('${id(2)}','norole@example.com'),('${id(3)}','inactive@example.com');
    insert into roles values('${id(10)}','APPLIER',true);
    insert into user_roles values('${id(1)}','${id(10)}'),('${id(3)}','${id(10)}');
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/202609251600_v3_124_extension_pairing.sql", import.meta.url), "utf8"));
  const as = uid => db.exec(`select set_config('test.uid','${uid}',false)`);
  const approve = (pairing, value = challenge) => db.query("select approve_extension_pairing_v124($1,$2) result", [pairing, value]);
  const redeem = async (pairing, value = secret) => (await db.query("select redeem_extension_pairing_v124($1,$2) result", [pairing, value])).rows[0].result;

  assert.deepEqual(await redeem(id(20)), { state: "PENDING" });
  await as(id(2)); await assert.rejects(() => approve(id(20)), /assign you a role/);
  await as(""); await assert.rejects(() => approve(id(20)), /Sign in with an active account/);
  await as(id(1)); await assert.rejects(() => approve(id(20), "not-a-hash"), /incomplete/);
  await approve(id(20));
  await assert.rejects(() => approve(id(20)), /already approved/);
  await assert.rejects(() => redeem(id(20), "x".repeat(43)), /invalid/);
  assert.deepEqual(await redeem(id(20)), { state: "APPROVED", userId: id(1), email: "applier@example.com" });
  assert.deepEqual(await redeem(id(20)), { state: "USED" });

  await approve(id(21));
  await db.exec(`update extension_pairings set expires_at=now()-interval '1 second' where id='${id(21)}'`);
  assert.deepEqual(await redeem(id(21)), { state: "EXPIRED" });

  await as(id(3)); await assert.rejects(() => approve(id(22)), /active account/);
  await db.exec("set role authenticated");
  await assert.rejects(() => db.query("select * from extension_pairings"), /permission denied/);
  await assert.rejects(() => redeem(id(20)), /permission denied/);
  await db.exec("reset role");
});

test("the extension's secret, challenge, code, and dashboard link line up", async () => {
  const pairing = await createPairing();
  assert.match(pairing.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pairing.challenge, sha(pairing.secret));
  assert.equal(pairing.code, confirmationCode(pairing.challenge));
  assert.match(pairing.code, /^[0-9A-F]{3}-[0-9A-F]{3}$/);
  const url = pairingUrl("https://all4u-url-extraction.vercel.app/some/path?x=1", pairing);
  assert.equal(url, `https://all4u-url-extraction.vercel.app/#/connect-extension?pairing=${pairing.pairingId}&challenge=${pairing.challenge}`);
  const route = parseRoute(url.slice(url.indexOf("#")));
  assert.equal(route.name, "connect-extension");
  assert.deepEqual(parseConnectRequest(route.query), { pairingId: pairing.pairingId, challenge: pairing.challenge, code: pairing.code });
  assert.equal(parseConnectRequest("pairing=bad&challenge=" + pairing.challenge), null);
});

test("the extension polls until approval, and stops on expiry, cancellation, or a final error", async () => {
  const pairing = { pairingId: id(30), secret };
  const answers = [{ state: "PENDING" }, { state: "PENDING" }, { state: "APPROVED", session: { accessToken: "a", refreshToken: "r" } }];
  let sleeps = 0;
  assert.deepEqual(await waitForApproval("https://api.example", pairing, { redeem: async () => answers.shift(), sleep: async () => { sleeps++; } }), { accessToken: "a", refreshToken: "r" });
  assert.equal(sleeps, 2);
  let clock = 0;
  await assert.rejects(() => waitForApproval("https://api.example", pairing, { redeem: async () => ({ state: "PENDING" }), sleep: async () => {}, now: () => (clock += 60_000) }), /expired/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => waitForApproval("https://api.example", pairing, { signal: controller.signal, redeem: async () => ({ state: "PENDING" }) }), /cancelled/);

  const seen = [];
  const fetchOk = async (url, options) => { seen.push([url, JSON.parse(options.body), options.headers.Authorization]); return new Response(JSON.stringify({ data: { state: "PENDING" } }), { status: 200 }); };
  assert.deepEqual(await redeemPairing("https://api.example/", pairing, fetchOk), { state: "PENDING" });
  assert.deepEqual(seen, [["https://api.example/api/v1/extension-pairings/redeem", { pairingId: id(30), secret }, undefined]]);
  assert.deepEqual(await redeemPairing("https://api.example", pairing, async () => { throw new TypeError("offline"); }), { state: "PENDING" });
  await assert.rejects(() => redeemPairing("https://api.example", pairing, async () => new Response(JSON.stringify({ code: "EXTENSION_PAIRING_EXPIRED", message: "expired" }), { status: 410 })), /expired/);
});

test("the extension works out of the box with built-in settings, and saved settings still win", async () => {
  const storage = values => ({ get: async () => values });
  const builtIn = await loadConfig(storage({}));
  assert.equal(builtIn.usingBuiltInConfig, true);
  assert.deepEqual(builtIn.supabaseConfig, { projectUrl: BUILT_IN_CONFIG.projectUrl, publishableKey: BUILT_IN_CONFIG.publishableKey });
  assert.equal(builtIn.backendConfig.baseUrl, BUILT_IN_CONFIG.apiBaseUrl);
  assert.equal(builtIn.dashboardUrl, BUILT_IN_CONFIG.dashboardUrl);
  assert.match(BUILT_IN_CONFIG.publishableKey, /^sb_publishable_/);
  const custom = await loadConfig(storage({ supabaseConfig: { projectUrl: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_customcustomcustom" }, backendConfig: { baseUrl: "http://localhost:3000", dashboardUrl: "http://localhost:4174" } }));
  assert.equal(custom.usingBuiltInConfig, false);
  assert.equal(custom.backendConfig.baseUrl, "http://localhost:3000");
  assert.equal(custom.dashboardUrl, "http://localhost:4174");
});

test("only the Connect link survives the dashboard sign-in redirect, and only once", () => {
  const store = new Map(), storage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null, removeItem: k => store.delete(k) };
  const link = `#/connect-extension?pairing=${id(40)}&challenge=${challenge}`;
  rememberReturnRoute("#/admin/users", storage);
  assert.equal(takeReturnRoute(storage), null);
  rememberReturnRoute(link, storage);
  assert.equal(takeReturnRoute(storage), link);
  assert.equal(takeReturnRoute(storage), null);
});
