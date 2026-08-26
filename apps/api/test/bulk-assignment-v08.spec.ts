import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BulkAssignDto, BulkAssignmentPreviewDto, UpdateWorkloadSettingsDto } from "../src/bulk-assignment/bulk-assignment.dto.js";
import { BulkAssignmentService } from "../src/bulk-assignment/bulk-assignment.service.js";

const id = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";

test("v0.8 DTOs enforce PROFILE strategy, capacity, limits, and unknown-field-safe shapes", async () => {
  assert.equal((await validate(plainToInstance(BulkAssignmentPreviewDto, { strategy: "EVEN", applicationIds: [id] }))).length > 0, true);
  assert.equal((await validate(plainToInstance(BulkAssignmentPreviewDto, { strategy: "PROFILE", applicationIds: [id] }))).length, 0);
  assert.equal((await validate(plainToInstance(BulkAssignmentPreviewDto, { strategy: "PROFILE" }))).length > 0, true);
  assert.equal((await validate(plainToInstance(UpdateWorkloadSettingsDto, { isAvailable: true, maxActiveApplications: 10001 }))).length > 0, true);
  assert.equal((await validate(plainToInstance(BulkAssignDto, { strategy: "EVEN", assignments: [{ applicationId: id, assignedTo: id2 }] }))).length > 0, true);
  assert.equal((await validate(plainToInstance(BulkAssignDto, { strategy: "PROFILE", assignments: [{ applicationId: id, assignedTo: id2 }] }))).length, 0);
});

test("bulk assignment service hashes idempotency metadata and uses one commit RPC", async () => {
  const calls: any[] = [];
  const supabase = { forUser: () => ({ rpc: (name: string, args: any) => { calls.push({ name, args }); return Promise.resolve({ data: { batchId: "batch", assignedCount: 1 }, error: null }); } }) };
  const logger = { log: () => {} };
  const service = new BulkAssignmentService(supabase as any, logger as any);
  await service.assign({ id: "user", token: "jwt", claims: {} }, { strategy: "PROFILE", assignments: [{ applicationId: id, assignedTo: id2 }] }, "same-key-123", "req");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "assign_applications_bulk_v08");
  assert.equal(calls[0].args.p_strategy, "PROFILE");
  assert.match(calls[0].args.p_idempotency_key_hash, /^[0-9a-f]{64}$/);
  assert.match(calls[0].args.p_request_payload_hash, /^[0-9a-f]{64}$/);
});

test("bulk assignment preview rejects non-PROFILE strategies and sends application ids only", async () => {
  const calls: any[] = [];
  const supabase = { forUser: () => ({ rpc: (name: string, args: any) => { calls.push({ name, args }); return Promise.resolve({ data: { proposals: [] }, error: null }); } }) };
  const logger = { log: () => {} };
  const service = new BulkAssignmentService(supabase as any, logger as any);
  await assert.rejects(
    () => service.preview({ id: "user", token: "jwt", claims: {} }, { strategy: "EVEN", applicationIds: [id], applierIds: [id2] }, "req"),
    (error: any) => error.code === "INVALID_STRATEGY",
  );
  await service.preview({ id: "user", token: "jwt", claims: {} }, { strategy: "PROFILE", applicationIds: [id] }, "req");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "preview_bulk_assignment_v08");
  assert.equal(calls[0].args.p_strategy, "PROFILE");
  assert.deepEqual(calls[0].args.p_application_ids, [id]);
  assert.deepEqual(calls[0].args.p_applier_ids, []);
});
