import test from "node:test";
import assert from "node:assert/strict";
import {
  attachApplicationScreenshot,
  listMyApplications,
  prepareApplicationScreenshot,
  updateApplicationProgress,
} from "../extension/services/application-service.js";
import { getMyAccessContext } from "../extension/services/access-service.js";

const APPLICATION_ID = "123e4567-e89b-42d3-a456-426614174000";

test("extension startup reads access context directly with the authenticated Supabase session", async () => {
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } }, error: null }) },
    rpc: async (name) => { calls.push(name); return { data: { userId: "user-1", email: "a@example.com", status: "ACTIVE", roles: ["APPLIER"] }, error: null }; },
  };
  const access = await getMyAccessContext(client, "https://api.example.com");
  assert.equal(access.status, "ACTIVE");
  assert.deepEqual(calls, ["get_my_access_context"]);
});

test("speed path lists and updates My Applications through one caller-scoped RPC each", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "list_my_applications_v20") {
        return { data: { items: [{ id: APPLICATION_ID }], resumes: [], total: 1, limit: 100 }, error: null };
      }
      return { data: { id: APPLICATION_ID, status: "IN_PROGRESS" }, error: null };
    },
  };
  assert.equal((await listMyApplications(client, "https://api.example.com")).items[0].id, APPLICATION_ID);
  assert.equal((await updateApplicationProgress(client, "https://api.example.com", APPLICATION_ID, { status: "IN_PROGRESS", applicationUrl: "", notes: "Working" })).status, "IN_PROGRESS");
  assert.deepEqual(calls.map((call) => call.name), ["list_my_applications_v20", "update_application_status_v101"]);
});

test("large screenshots are resized to bounded WebP only when the result is smaller", async () => {
  let dimensions, closed = false;
  class Canvas {
    constructor(width, height) { dimensions = [width, height]; }
    getContext() { return { drawImage() {} }; }
    async convertToBlob(options) {
      assert.equal(options.type, "image/webp");
      return new Blob([new Uint8Array(100)], { type: "image/webp" });
    }
  }
  const original = new File([new Uint8Array(400_000)], "confirmation.png", { type: "image/png" });
  const prepared = await prepareApplicationScreenshot(original, {
    createBitmap: async () => ({ width: 4000, height: 2000, close: () => { closed = true; } }),
    Canvas,
  });
  assert.deepEqual(dimensions, [1800, 900]);
  assert.equal(prepared.type, "image/webp");
  assert.equal(prepared.name, "confirmation.webp");
  assert.equal(prepared.size, 100);
  assert.equal(closed, true);
});

test("screenshot upload goes directly to private Storage and then the attachment RPC", async () => {
  const calls = [];
  const file = new File(["image"], "confirmation.png", { type: "image/png" });
  const client = {
    storage: { from: (bucket) => ({
      upload: async (path, uploaded, options) => { calls.push({ type: "upload", bucket, path, uploaded, options }); return { error: null }; },
      remove: async (paths) => { calls.push({ type: "remove", bucket, paths }); return { error: null }; },
    }) },
    rpc: async (name, args) => {
      calls.push({ type: "rpc", name, args });
      return { data: { id: "screenshot-1", application_id: APPLICATION_ID, storage_bucket: "application-screenshots", storage_path: args.p_storage_path }, error: null };
    },
  };
  const result = await attachApplicationScreenshot(client, "https://api.example.com", APPLICATION_ID, file);
  assert.equal(result.id, "screenshot-1");
  assert.deepEqual(calls.map((call) => call.type), ["upload", "rpc"]);
  assert.equal(calls[0].bucket, "application-screenshots");
  assert.match(calls[0].path, new RegExp(`^${APPLICATION_ID}/`));
  assert.equal(calls[1].name, "attach_application_screenshot");
  assert.equal(calls[1].args.p_file_size_bytes, file.size);
});

test("screenshot upload retries transient Storage database timeouts", async () => {
  const calls = [];
  const file = new File(["image"], "confirmation.png", { type: "image/png" });
  const client = {
    storage: { from: () => ({
      upload: async (path) => {
        calls.push(path);
        if (calls.length < 3) return { error: { message: "The connection to the database timed out", statusCode: 544 } };
        return { error: null };
      },
      remove: async () => ({ error: null }),
    }) },
    rpc: async (_name, args) => ({ data: { id: "screenshot-2", storage_path: args.p_storage_path }, error: null }),
  };
  const result = await attachApplicationScreenshot(client, "https://api.example.com", APPLICATION_ID, file);
  assert.equal(result.id, "screenshot-2");
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls).size, 1);
});
