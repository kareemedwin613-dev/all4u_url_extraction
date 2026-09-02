import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("v3.49 bulk delete application batches RPC is manager-only and enforces safety checks", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202609020112_v3_49_bulk_delete_application_batches.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /bulk_delete_application_batches_v316/);
  assert.match(sql, /perform public\.assert_application_manager\(\)/);
  assert.match(sql, /BATCH_STILL_PROCESSING/);
  assert.match(sql, /BATCH_HAS_ACTIVE_APPLICATIONS/);
  assert.match(sql, /delete from public\.applications/);
  assert.match(sql, /delete from public\.application_creation_batches/);
  assert.match(sql, /grant execute on function public\.bulk_delete_application_batches_v316[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /service_role/);
});

test("application batches page exposes guarded bulk delete controls", async () => {
  const source = await readFile(
    new URL("../dashboard/src/features/bulk-applications/bulk-pages.jsx", import.meta.url),
    "utf8",
  );
  const list = source.slice(
    source.indexOf("export function ApplicationBatchesPage"),
    source.indexOf("export function ApplicationBatchDetailPage"),
  );
  assert.match(list, /deleteApplicationBatches/);
  assert.match(list, /Delete Selected/);
  assert.match(list, /rowSelection/);
  assert.match(list, /row\.status === "PROCESSING"/);
  assert.match(source, /Delete Batch/);
});

test("bulk service posts batch ids to bulk-delete endpoint", async () => {
  const { deleteApplicationBatches } = await import("../dashboard/src/features/bulk-applications/bulk-service.js");
  const batchId = "f3a34ffd-d66a-49f7-815e-c7786857576b";
  let requested;
  const originalFetch = globalThis.fetch;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
  globalThis.fetch = async (url, options) => {
    requested = { url: new URL(url), body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({ data: { total: 1, succeeded: 1, failed: 0, results: [{ id: batchId, ok: true }] } }),
      { status: 200 },
    );
  };
  try {
    const result = await deleteApplicationBatches(client, "https://api.example.com", { batchIds: [batchId] });
    assert.equal(result.succeeded, 1);
    assert.equal(requested.url.pathname, "/api/v1/application-batches/bulk-delete");
    assert.deepEqual(requested.body.batchIds, [batchId]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
