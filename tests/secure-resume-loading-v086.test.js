import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadResumeBytes, MemoryResumeStore } from "../extension/background/resume-loader.js";

const access = { signedUrl: "https://storage.example/signed", filename: "candidate.pdf", mimeType: "application/pdf", fileSizeBytes: 4, expiresAt: new Date(Date.now() + 60_000).toISOString() };

test("v0.8.6 validates and downloads bounded Resume bytes without credentials", async () => {
  let request;
  const loaded = await downloadResumeBytes(access, async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-length": "4" } });
  });
  assert.deepEqual([...loaded.bytes], [1, 2, 3, 4]);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.method, "GET");
});

test("v0.8.6 rejects invalid types, oversized metadata, and byte-size mismatches", async () => {
  await assert.rejects(() => downloadResumeBytes({ ...access, mimeType: "text/html" }, async () => new Response()), /RESUME_METADATA_INVALID/);
  await assert.rejects(() => downloadResumeBytes({ ...access, fileSizeBytes: 6 * 1024 * 1024 }, async () => new Response()), /RESUME_METADATA_INVALID/);
  await assert.rejects(() => downloadResumeBytes(access, async () => new Response(new Uint8Array([1, 2]), { status: 200 })), /RESUME_SIZE_MISMATCH/);
});

test("v0.8.6 keeps Resume bytes in an in-memory store and zeroes them when cleared", () => {
  const bytes = new Uint8Array([7, 8, 9, 10]);
  const store = new MemoryResumeStore();
  store.put("session-1", { applicationId: "app-1", bytes, filename: "candidate.pdf", mimeType: "application/pdf", fileSizeBytes: 4, loadedAt: "2026-07-28T00:00:00Z" });
  assert.equal(store.status("session-1").ready, true);
  store.clear("session-1");
  assert.deepEqual([...bytes], [0, 0, 0, 0]);
  assert.equal(store.status("session-1").ready, false);
});

test("v0.8.6 service worker never persists Resume bytes, URLs, or tokens", async () => {
  const source = await readFile(new URL("../extension/background/service-worker.js", import.meta.url), "utf8");
  const loader = await readFile(new URL("../extension/background/resume-loader.js", import.meta.url), "utf8");
  assert.match(source, /\/resume-access/);
  assert.match(source, /attempt<2/);
  assert.match(loader, /new File\(\[loaded\.bytes\]/);
  assert.doesNotMatch(source, /chrome\.storage\.(local|session)\.set\([^)]*(signedUrl|accessToken|bytes)/s);
  assert.doesNotMatch(source + loader, /console\.(log|info|debug|warn|error)/);
});
