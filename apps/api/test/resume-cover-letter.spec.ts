import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ResumeService } from "../src/resumes/resume.service.js";

const user = { id: "123e4567-e89b-42d3-a456-426614174000", token: "jwt", claims: {} };
const resumeId = "323e4567-e89b-42d3-a456-426614174000";
const ownerId = "423e4567-e89b-42d3-a456-426614174000";
const file = { size: 2048, mimetype: "application/pdf", originalname: "Cover.pdf", buffer: Buffer.from("%PDF-cover") };

function serviceWith(handlers) {
  return new ResumeService({
    forUser: (token) => {
      assert.equal(token, "jwt");
      return handlers;
    },
  } as any);
}

test("cover letter upload stores object then updates Resume via RPC", async () => {
  const removed = [];
  let uploadedPath = "";
  let rpcArgs;
  const client = {
    storage: {
      from: (bucket) => {
        assert.equal(bucket, "cover-letters");
        return {
          upload: async (path, buffer, options) => {
            uploadedPath = path;
            assert.equal(options.upsert, true);
            assert.ok(Buffer.isBuffer(buffer));
            return { error: null };
          },
          remove: async (paths) => {
            removed.push(...paths);
            return { error: null };
          },
          createSignedUrl: async () => ({ data: null, error: null }),
        };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: resumeId,
              user_id: ownerId,
              resume_type: "ORIGINAL",
              resume_number: 7,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name, args) => {
      assert.equal(name, "set_resume_cover_letter_v37");
      rpcArgs = args;
      return {
        data: {
          previousPath: `${ownerId}/${resumeId}/cover-old.pdf`,
          previousBucket: "cover-letters",
          resume: {
            id: resumeId,
            cover_letter_storage_path: args.p_storage_path,
            cover_letter_original_filename: "Cover.pdf",
          },
        },
        error: null,
      };
    },
  };
  const result = await serviceWith(client).uploadCoverLetter(user as any, resumeId, file);
  assert.match(uploadedPath, new RegExp(`^${ownerId}/${resumeId}/cover-`));
  assert.equal(rpcArgs.p_resume_id, resumeId);
  assert.equal(rpcArgs.p_mime_type, "application/pdf");
  assert.equal(rpcArgs.p_file_size_bytes, 2048);
  assert.match(rpcArgs.p_file_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(removed, [`${ownerId}/${resumeId}/cover-old.pdf`]);
  assert.equal(result.cover_letter_original_filename, "Cover.pdf");
});

test("cover letter upload rejects tailored Resumes and invalid files", async () => {
  const tailored = serviceWith({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: resumeId, user_id: ownerId, resume_type: "TAILORED" },
            error: null,
          }),
        }),
      }),
    }),
  });
  await assert.rejects(
    () => tailored.uploadCoverLetter(user as any, resumeId, file),
    (error) => error.code === "RESUME_TYPE_INVALID",
  );
  const invalid = serviceWith({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: resumeId, user_id: ownerId, resume_type: "ORIGINAL" },
            error: null,
          }),
        }),
      }),
    }),
  });
  await assert.rejects(
    () => invalid.uploadCoverLetter(user as any, resumeId, { ...file, mimetype: "image/png" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("cover letter signed URL requires an attached file", async () => {
  const service = serviceWith({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: resumeId, resume_type: "ORIGINAL", cover_letter_storage_path: null },
            error: null,
          }),
        }),
      }),
    }),
  });
  await assert.rejects(
    () => service.coverLetterSignedUrl(user as any, resumeId),
    (error) => error.code === "COVER_LETTER_NOT_FOUND",
  );
});

test("cover letter remove clears metadata and deletes storage object", async () => {
  const removed = [];
  const client = {
    storage: {
      from: (bucket) => {
        assert.equal(bucket, "cover-letters");
        return {
          remove: async (paths) => {
            removed.push(...paths);
            return { error: null };
          },
        };
      },
    },
    rpc: async (name, args) => {
      assert.equal(name, "clear_resume_cover_letter_v37");
      assert.equal(args.p_resume_id, resumeId);
      return {
        data: {
          previousPath: `${ownerId}/${resumeId}/cover-Cover.pdf`,
          previousBucket: "cover-letters",
          resume: { id: resumeId, cover_letter_storage_path: null },
        },
        error: null,
      };
    },
  };
  const result = await serviceWith(client).removeCoverLetter(user as any, resumeId);
  assert.deepEqual(removed, [`${ownerId}/${resumeId}/cover-Cover.pdf`]);
  assert.equal(result.cover_letter_storage_path, null);
});
