import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { TailoringPromptsModule } from "../src/tailoring-prompts/tailoring-prompts.module.js";
import { SupabaseService } from "../src/supabase/supabase.service.js";
import { JwtVerifier } from "../src/auth/jwt-verifier.service.js";
import { ApiExceptionFilter } from "../src/common/errors/api-exception.filter.js";
import { JsonLogger } from "../src/common/logging/json-logger.service.js";

test("prompt HTTP API preserves authorization, validation, RPC arguments, and error semantics", async t => {
  const promptId = "11111111-1111-4111-8111-111111111111";
  const jobId = "22222222-2222-4222-8222-222222222222";
  let role = "ADMIN", active = true;
  let error: { code: string; message: string } | null = null;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const module = await Test.createTestingModule({ imports: [TailoringPromptsModule] })
    .overrideProvider(JwtVerifier).useValue({ verify: async (token: string) => ({ id: promptId, token, claims: {} }) })
    .overrideProvider(JsonLogger).useValue({ warn() {}, info() {}, error() {} })
    .overrideProvider(SupabaseService).useValue({
      anonymous: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args }); return { data: { status: "COMPLETED" }, error };
      } }),
      accessContext: async () => ({ data: { status: active ? "ACTIVE" : "INACTIVE", roles: [role] }, error: null }),
      forUser: (token: string) => {
        assert.equal(token, "test-jwt");
        return { rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          return { data: { id: promptId, revision: 2, versions: [{ version: 1 }], events: [] }, error };
        } };
      },
    }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  t.after(() => app.close());
  const api = request(app.getHttpServer()), base = "/api/v1/tailoring-prompts";
  const post = (path: string, body: object) => api.post(base + path).set("Authorization", "Bearer test-jwt").send(body);
  const get = (path = "") => api.get(base + path).set("Authorization", "Bearer test-jwt");
  const draft = { name: " Java ", instructions: "Use concise bullet points.\nPreserve formatting.", priority: 20 };

  await t.test("draft tests use authenticated creation and a separate capability-only runner", async () => {
    await post(`/${promptId}/tests`, { applicationId: jobId, expectedRevision: 2 }).expect(201);
    assert.deepEqual(calls.at(-1), { name: "create_tailoring_prompt_test_v113", args: {
      p_prompt_id: promptId, p_expected_revision: 2, p_application_id: jobId,
    } });
    await get(`/tests/${jobId}`).expect(200);
    assert.equal(calls.at(-1)?.name, "read_tailoring_prompt_test_v113");
    role = "APPLIER";
    await post(`/${promptId}/tests`, { applicationId: jobId, expectedRevision: 2 }).expect(403);
    await get(`/tests/${jobId}`).expect(403);
    role = "ADMIN";
    const runner = "/api/v1/tailoring-prompt-test-runner", ticket = "tpt_" + "a".repeat(64);
    await api.post(runner).send({ ticket, action: "CLAIM" }).expect(201);
    assert.deepEqual(calls.at(-1), { name: "run_tailoring_prompt_test_v113", args: {
      p_ticket: ticket, p_action: "CLAIM", p_result: null, p_failure_code: null,
    } });
    const before = calls.length;
    await api.post(runner).send({ ticket: "bad", action: "CLAIM" }).expect(400);
    await api.post(runner).send({ ticket, action: "PUBLISH" }).expect(400);
    await api.post(runner).send({ ticket, action: "SUBMIT", result: [] }).expect(400);
    assert.equal(calls.length, before);
  });

  await t.test("manager/admin routes forward only user-scoped allowlisted configuration", async () => {
    await get().expect(200);
    assert.deepEqual(calls.at(-1), { name: "read_tailoring_prompts_v1", args: {} });
    await get(`/${promptId}`).expect(200);
    await get(`/${promptId}/history`).expect(200).expect(({ body }) => {
      assert.deepEqual(body.data, { versions: [{ version: 1 }], events: [] });
    });
    await post("", { ...draft, scope: "SUBTYPE", primaryCategoryId: promptId, subcategoryId: jobId }).expect(201);
    assert.deepEqual(calls.at(-1), { name: "manage_tailoring_prompt_v1", args: {
      p_action: "CREATE", p_name: "Java", p_body: draft.instructions, p_priority: 20,
      p_scope: "SUBTYPE", p_primary_category_id: promptId, p_subcategory_id: jobId,
    } });
    await api.put(`${base}/${promptId}/draft`).set("Authorization", "Bearer test-jwt")
      .send({ ...draft, expectedRevision: 3 }).expect(200);
    assert.equal(calls.at(-1)?.args.p_action, "SAVE");
    assert.equal(calls.at(-1)?.args.p_expected_revision, 3);
    for (const action of ["publish", "archive", "restore"]) {
      await post(`/${promptId}/${action}`, { expectedRevision: 4, ...(action === "restore" ? { version: 1 } : {}) }).expect(201);
      assert.equal(calls.at(-1)?.args.p_action, action.toUpperCase());
      assert.equal(calls.at(-1)?.args.p_expected_revision, 4);
    }
    await post("/preview", { jobDescriptionId: jobId }).expect(201);
    assert.deepEqual(calls.at(-1), { name: "preview_tailoring_prompt_v1", args: { p_job_description_id: jobId } });
    role = "APPLYING_MANAGER";
    await get().expect(200);
    role = "ADMIN";
  });

  await t.test("malformed IDs, blank/oversized bodies, stale-token omissions, and unknown fields never reach SQL", async () => {
    const before = calls.length;
    await get("/not-a-uuid").expect(400);
    for (const extra of [{ instructions: " " }, { instructions: "x".repeat(20001) }, { name: " " },
      { priority: -1 }, { priority: null }, { priority: 1.5 }, { publishedBy: promptId }, { scope: "OTHER" }]) {
      await post("", { ...draft, scope: "GENERIC", ...extra }).expect(400);
    }
    await post(`/${promptId}/publish`, {}).expect(400);
    await post(`/${promptId}/publish`, { expectedRevision: null }).expect(400);
    await post(`/${promptId}/restore`, { expectedRevision: 1, version: 0 }).expect(400);
    await post("/preview", { jobDescriptionId: "invalid" }).expect(400);
    await api.put(`${base}/${promptId}/draft`).set("Authorization", "Bearer test-jwt")
      .send({ ...draft, expectedRevision: 1, scope: "GENERIC" }).expect(400);
    assert.equal(calls.length, before);
  });

  await t.test("unauthenticated, inactive, and applier callers cannot read or mutate the library", async () => {
    const before = calls.length;
    await api.get(base).expect(401);
    role = "APPLIER";
    await get().expect(403);
    await get(`/${promptId}/history`).expect(403);
    await post("", { ...draft, scope: "GENERIC" }).expect(403);
    for (const action of ["publish", "archive", "restore"]) {
      await post(`/${promptId}/${action}`, { expectedRevision: 1, version: 1 }).expect(403);
    }
    await post("/preview", { jobDescriptionId: jobId }).expect(403);
    role = "ADMIN"; active = false;
    await get().expect(403);
    active = true;
    assert.equal(calls.length, before);
  });

  await t.test("conflicts, missing records, and database errors use actionable safe HTTP responses", async () => {
    for (const [code, status] of [["PROMPT_STALE",409],["PROMPT_CONFLICT",409],
      ["PROMPT_FALLBACK_REQUIRED",409],["PROMPT_NOT_FOUND",404],["PROMPT_VERSION_NOT_FOUND",404],
      ["PROMPT_INVALID",400],["PROMPT_FORBIDDEN",403]] as const) {
      error = { code: "P0001", message: `${code}: Test diagnostic.` };
      await post(`/${promptId}/publish`, { expectedRevision: 1 }).expect(status).expect(({ body }) => assert.equal(body.code, code));
    }
    error = { code: "XX000", message: "private database details" };
    await get().expect(502).expect(({ body }) => assert.doesNotMatch(body.message, /private database/));
    error = null;
  });
});
