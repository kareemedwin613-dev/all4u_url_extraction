import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("bulk delete applications RPC is manager-only and requires cancelled status", async () => {
  const [sql, controller, service] = await Promise.all([
    read("../supabase/migrations/202609020114_v3_50_bulk_delete_applications.sql"),
    read("../apps/api/src/applications/application.controller.ts"),
    read("../apps/api/src/applications/application.service.ts"),
  ]);
  assert.match(sql, /bulk_delete_applications_v317/);
  assert.match(sql, /assert_application_manager/);
  assert.match(sql, /status <> 'CANCELLED'/);
  assert.match(sql, /delete from public\.applications/);
  assert.doesNotMatch(sql, /storage\.objects/);
  assert.match(controller, /bulk-delete/);
  assert.match(service, /bulk_delete_applications_v317/);
});

test("bulk delete service posts selected application ids to the API", async () => {
  let request;
  const originalFetch = globalThis.fetch;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
  const id = "f3a34ffd-d66a-49f7-815e-c7786857576b";
  const id2 = "b4d63a80-e306-4a2f-afca-29cd4b3951e0";
  globalThis.fetch = async (url, options) => {
    request = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : null };
    return new Response(
      JSON.stringify({ data: { total: 2, succeeded: 2, failed: 0, results: [] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const { bulkDeleteApplications } = await import("../dashboard/src/features/applications/application-service.js");
    const result = await bulkDeleteApplications(client, "https://api.example.com", {
      applicationIds: [id, id2],
    });
    assert.equal(result.succeeded, 2);
    assert.equal(request.options.method, "POST");
    assert.equal(request.url.pathname, "/api/v1/applications/bulk-delete");
    assert.deepEqual(request.body.applicationIds, [id, id2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Applications page exposes deletion selection mode and delete action", async () => {
  const source = await read("../dashboard/src/features/applications/application-pages.jsx", "utf8");
  assert.match(source, /Select For Deletion/);
  assert.match(source, /Delete Selected/);
  assert.match(source, /bulkDeleteApplications/);
  assert.match(source, /selectionMode === "DELETE"/);
});
