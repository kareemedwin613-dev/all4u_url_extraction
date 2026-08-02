import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/applications/application.service.js";

const applicationId = "123e4567-e89b-42d3-a456-426614174000";
const user = { id: "user-1", token: "user-jwt", claims: {} };
const context = {
  permissions: { canLoadResume: true },
  resume: { status: "ACTIVE", originalFilename: "candidate.pdf", mimeType: "application/pdf", fileSizeBytes: 1024 },
};

function serviceWith(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "get_application_extension_context_v085") return { data: overrides.context || context, error: null };
      if (name === "get_application_resume_file") return { data: overrides.file || { bucket: "original-resumes", path: "owner/candidate.pdf", filename: "candidate.pdf" }, error: null };
      throw new Error("Unexpected RPC");
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, seconds: number) => {
      calls.push(`sign:${bucket}:${path}:${seconds}`);
      return { data: { signedUrl: "https://storage.example/signed-resume" }, error: null };
    } }) },
  };
  return { service: new ApplicationService({ forUser: (token: string) => { assert.equal(token, user.token); return client; } } as any), calls };
}

test("v0.8.6 authorizes the Application Resume and signs it with the request-scoped user client", async () => {
  const { service, calls } = serviceWith();
  const result = await service.resumeAccess(user as any, applicationId);
  assert.equal(result.filename, "candidate.pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.fileSizeBytes, 1024);
  assert.match(result.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls, ["get_application_extension_context_v085", "get_application_resume_file", "sign:original-resumes:owner/candidate.pdf:60"]);
});

test("v0.8.6 rejects inactive or mismatched Resume metadata before signing", async () => {
  const inactive = serviceWith({ context: { ...context, resume: { ...context.resume, status: "ARCHIVED" } } });
  await assert.rejects(() => inactive.service.resumeAccess(user as any, applicationId), (error: any) => error.code === "APPLICATION_RESUME_UNAVAILABLE");
  assert.doesNotMatch(inactive.calls.join(" "), /sign:/);

  const mismatched = serviceWith({ file: { bucket: "original-resumes", path: "owner/other.pdf", filename: "other.pdf" } });
  await assert.rejects(() => mismatched.service.resumeAccess(user as any, applicationId), (error: any) => error.code === "APPLICATION_RESUME_METADATA_INVALID");
  assert.doesNotMatch(mismatched.calls.join(" "), /sign:/);
});
