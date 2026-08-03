import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareRoutedRequest, routedUrl } from "../api/request-url.mjs";

test("Vercel routes API and health requests into one Nest function", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.outputDirectory, "dashboard/dist");
  assert.equal(config.functions["api/index.mjs"].maxDuration, 60);
  assert.equal(typeof config.functions["api/index.mjs"].includeFiles, "string");
  assert.match(config.functions["api/index.mjs"].includeFiles, /apps\/api\/dist\/\*\*/);
  assert.match(config.functions["api/index.mjs"].includeFiles, /apps\/api\/node_modules\/pdfkit\/js\/data\/\*\*/);
  assert.match(config.functions["api/index.mjs"].includeFiles, /packages\/contracts\/dist\/\*\*/);
  assert.ok(config.rewrites.some((item) => item.source === "/api/v1/:path*" && item.destination.includes("/api/index")));
  assert.ok(config.rewrites.some((item) => item.source === "/health"));
  assert.equal(config.rewrites.at(-1).destination, "/index.html");
});

test("Vercel route metadata is removed before Nest handles the request", () => {
  assert.equal(routedUrl({ url: "/api/index", query: { __path: "/health" } }), "/health");
  assert.equal(routedUrl({ url: "/api/index", query: { __path: "/api/v1/applications", page: "2", status: ["A", "B"] } }), "/api/v1/applications?page=2&status=A&status=B");
  assert.equal(routedUrl({ url: "/api/index", query: { __path: "/api/v1/assignment-batches", path: "assignment-batches", limit: "25" } }), "/api/v1/assignment-batches?limit=25");
  assert.equal(routedUrl({ url: "/unchanged", query: {} }), "/unchanged");
});

test("Vercel cached query metadata cannot shadow Express query parsing", () => {
  const request = { url: "/api/index", query: { __path: "/api/v1/application-batches", path: "application-batches", search: "", page: "1", pageSize: "25" } };
  prepareRoutedRequest(request);
  assert.equal(request.url, "/api/v1/application-batches?search=&page=1&pageSize=25");
  assert.equal(Object.prototype.hasOwnProperty.call(request, "query"), false);
});
