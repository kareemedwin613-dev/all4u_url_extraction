import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ResumeService } from "../src/resumes/resume.service.js";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", token: "jwt", claims: {} };
const resumeId = "323e4567-e89b-42d3-a456-426614174000";
const entryId = "423e4567-e89b-42d3-a456-426614174000";

function serviceWith(handlers) {
  return new ResumeService({
    forUser: (token) => {
      assert.equal(token, "jwt");
      return handlers;
    },
  } as any);
}

test("banned company list returns RPC rows", async () => {
  const service = serviceWith({
    rpc: async (name, args) => {
      assert.equal(name, "list_resume_banned_companies_v38");
      assert.equal(args.p_resume_id, resumeId);
      return {
        data: [{ id: entryId, resumeId, companyName: "Google", normalizedCompany: "google" }],
        error: null,
      };
    },
  });
  const rows = await service.listBannedCompanies(user as any, resumeId);
  assert.equal(rows[0].companyName, "Google");
});

test("banned company add validates and calls RPC", async () => {
  const service = serviceWith({
    rpc: async (name, args) => {
      assert.equal(name, "add_resume_banned_company_v38");
      assert.equal(args.p_resume_id, resumeId);
      assert.equal(args.p_company_name, "Amazon");
      return { data: { id: entryId, companyName: "Amazon" }, error: null };
    },
  });
  const row = await service.addBannedCompany(user as any, resumeId, "  Amazon  ");
  assert.equal(row.companyName, "Amazon");
  await assert.rejects(
    () => service.addBannedCompany(user as any, resumeId, ""),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("banned company remove calls RPC", async () => {
  const service = serviceWith({
    rpc: async (name, args) => {
      assert.equal(name, "remove_resume_banned_company_v38");
      assert.equal(args.p_resume_id, resumeId);
      assert.equal(args.p_id, entryId);
      return { data: { id: entryId, companyName: "Optum" }, error: null };
    },
  });
  const row = await service.removeBannedCompany(user as any, resumeId, entryId);
  assert.equal(row.companyName, "Optum");
});

test("banned company duplicate maps to ApiException", async () => {
  const service = serviceWith({
    rpc: async () => ({
      data: null,
      error: { message: "BANNED_COMPANY_DUPLICATE: That company is already on this Resume ban list." },
    }),
  });
  await assert.rejects(
    () => service.addBannedCompany(user as any, resumeId, "Google"),
    (error) => error.code === "BANNED_COMPANY_DUPLICATE",
  );
});
