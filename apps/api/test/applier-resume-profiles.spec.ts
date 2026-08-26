import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SetApplierResumeProfilesDto } from "../src/bulk-assignment/applier-resume-profile.dto.js";
import { BulkAssignmentService } from "../src/bulk-assignment/bulk-assignment.service.js";
import { ApplicationService } from "../src/applications/application.service.js";
import { ResumeService } from "../src/resumes/resume.service.js";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", token: "jwt", claims: {} };
const applierId = "223e4567-e89b-42d3-a456-426614174000";
const resumeId = "323e4567-e89b-42d3-a456-426614174000";
const otherResumeId = "423e4567-e89b-42d3-a456-426614174000";

function bulkService(handlers: any) {
  return new BulkAssignmentService(
    { forUser: (token: string) => { assert.equal(token, "jwt"); return handlers; } } as any,
    { log: () => {} } as any,
  );
}

test("set applier resume profiles DTO accepts exclusive resume id arrays", async () => {
  const ok = await validate(plainToInstance(SetApplierResumeProfilesDto, { resumeIds: [resumeId, otherResumeId] }));
  assert.equal(ok.length, 0);
  const empty = await validate(plainToInstance(SetApplierResumeProfilesDto, { resumeIds: [] }));
  assert.equal(empty.length, 0);
  const bad = await validate(plainToInstance(SetApplierResumeProfilesDto, { resumeIds: ["not-a-uuid"] }));
  assert.equal(bad.length > 0, true);
});

test("bulk assignment service lists and replaces applier resume profiles", async () => {
  const calls: any[] = [];
  const service = bulkService({
    rpc: (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "list_applier_resume_profiles_v313") {
        return Promise.resolve({ data: [{ resumeId, resumeName: "Derek" }], error: null });
      }
      if (name === "list_applier_resume_profile_options_v313") {
        return Promise.resolve({
          data: [{ resumeId, resumeName: "Derek", ownerApplierUserId: applierId }],
          error: null,
        });
      }
      if (name === "set_applier_resume_profiles_v313") {
        return Promise.resolve({ data: [{ resumeId }], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } });
    },
  });
  const listed = await service.listResumeProfiles(user as any, applierId);
  assert.equal(listed[0].resumeName, "Derek");
  const options = await service.listResumeProfileOptions(user as any);
  assert.equal(options[0].ownerApplierUserId, applierId);
  const saved = await service.setResumeProfiles(user as any, applierId, [resumeId, resumeId]);
  assert.equal(saved[0].resumeId, resumeId);
  assert.equal(calls[2].name, "set_applier_resume_profiles_v313");
  assert.deepEqual(calls[2].args.p_resume_ids, [resumeId]);
});

test("exclusive resume profile taken maps to conflict ApiException", async () => {
  const service = bulkService({
    rpc: async () => ({
      data: null,
      error: { message: 'RESUME_PROFILE_TAKEN: Resume "Derek" is already assigned to Khalid.' },
    }),
  });
  await assert.rejects(
    () => service.setResumeProfiles(user as any, applierId, [resumeId]),
    (error: any) => error.code === "RESUME_PROFILE_TAKEN" && error.getStatus() === 409,
  );
});

test("empty mapping and wrong applier map to clear assignment errors", async () => {
  const appService = new ApplicationService({
    forUser: () => ({
      rpc: async () => ({
        data: null,
        error: { message: "APPLIER_PROFILE_REQUIRED: This Applier cannot receive Applications until at least one Resume profile is assigned." },
      }),
    }),
  } as any);
  await assert.rejects(
    () => appService.assign(user as any, "523e4567-e89b-42d3-a456-426614174000", { newAssigneeId: applierId }),
    (error: any) => error.code === "APPLIER_PROFILE_REQUIRED",
  );

  const blocked = new ApplicationService({
    forUser: () => ({
      rpc: async () => ({
        data: null,
        error: { message: "APPLIER_RESUME_NOT_ALLOWED: Resume is not assigned to this Applier." },
      }),
    }),
  } as any);
  await assert.rejects(
    () => blocked.create(user as any, {
      jobDescriptionId: "623e4567-e89b-42d3-a456-426614174000",
      resumeId,
      assignedTo: applierId,
      priority: "NORMAL",
    }),
    (error: any) => error.code === "APPLIER_RESUME_NOT_ALLOWED",
  );
});

test("resume service returns owning applier profile", async () => {
  const service = new ResumeService({
    forUser: (token: string) => {
      assert.equal(token, "jwt");
      return {
        rpc: async (name: string, args: any) => {
          assert.equal(name, "get_resume_applier_profile_v313");
          assert.equal(args.p_resume_id, resumeId);
          return { data: { applierUserId: applierId, displayName: "Khalid", resumeId }, error: null };
        },
      };
    },
  } as any);
  const row = await service.applierProfile(user as any, resumeId);
  assert.equal(row.displayName, "Khalid");
});
