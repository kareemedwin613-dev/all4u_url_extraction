import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { routedUrl } from "../api/request-url.mjs";

test("Vercel routes API and health requests into one Nest function", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.outputDirectory, "dashboard/dist");
  assert.equal(config.functions["api/index.mjs"].maxDuration, 60);
  assert.equal(typeof config.functions["api/index.mjs"].includeFiles, "string");
  assert.equal(config.functions["api/index.mjs"].includeFiles, "{apps/api/dist/**,packages/contracts/dist/**}");
  assert.ok(config.rewrites.some((item) => item.source === "/api/v1/:path*" && item.destination.includes("/api/index")));
  assert.ok(config.rewrites.some((item) => item.source === "/health"));
  assert.equal(config.rewrites.at(-1).destination, "/index.html");
});

test("Vercel route metadata is removed before Nest handles the request", () => {
  assert.equal(routedUrl({ url: "/api/index", query: { __path: "/health" } }), "/health");
  assert.equal(routedUrl({ url: "/api/index", query: { __path: "/api/v1/applications", page: "2", status: ["A", "B"] } }), "/api/v1/applications?page=2&status=A&status=B");
  assert.equal(routedUrl({ url: "/unchanged", query: {} }), "/unchanged");
});
