import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { attachCoverLetterPayload, attachResumePayload, detectCoverLetterUploadInputs, detectResumeUploadInputs } from "../extension/autofill/resume-upload-adapter.js";
import { documentParts } from "../extension/sidepanel/document-outcomes.js";

// Gem-style uploads: the document's name is a <span> above a drop zone whose own text is only "Click to upload".
const upload = (question, accept = "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx") => `<div class="flex-30">
  <span class="bodyImportant-47">${question}<span> *</span></span>
  <div><div><div class="container-105" role="presentation"><input type="file" accept="${accept}"><div><span>Click to upload or drag and drop here</span></div></div></div></div></div>`;

function page(body) {
  const { document, window } = parseHTML(`<!doctype html><html><body><div class="flex-30">${body}</div></body></html>`);
  // The test DOM has no DataTransfer; this one keeps the files so the attach can be verified.
  class FakeDataTransfer { constructor() { const files = []; this.files = files; this.items = { add: (file) => files.push(file) }; } }
  Object.assign(globalThis, { Event: window.Event, DataTransfer: FakeDataTransfer });
  return document;
}

const payload = (filename, text = "%PDF-1.4 test") => {
  const bytes = Buffer.from(text);
  return { base64: bytes.toString("base64"), filename, mimeType: "application/pdf", fileSizeBytes: bytes.length };
};

test("a cover letter upload is found by the section that names it, and never the Resume upload", () => {
  const document = page(upload("Resume") + upload("Cover letter"));
  const [resumeInput, coverInput] = document.querySelectorAll("input[type=file]");
  assert.deepEqual(detectCoverLetterUploadInputs(document).map((item) => item.input), [coverInput]);
  assert.deepEqual(detectResumeUploadInputs(document).map((item) => item.input), [resumeInput]);
});

test("the cover letter file goes into the cover letter upload", () => {
  const document = page(upload("Resume") + upload("Cover letter"));
  const [resumeInput, coverInput] = document.querySelectorAll("input[type=file]");
  const result = attachCoverLetterPayload(payload("Cover Letter.pdf"), document);
  assert.equal(result.status, "ATTACHED");
  assert.equal(result.code, "COVER_LETTER_ATTACHED");
  assert.equal(coverInput.files[0].name, "Cover Letter.pdf");
  assert.equal(resumeInput.files, undefined);
});

test("a page without a cover letter upload reports it, and an upload that also names the Resume is not used", () => {
  assert.equal(attachCoverLetterPayload(payload("Cover Letter.pdf"), page(upload("Resume"))).code, "COVER_LETTER_INPUT_NOT_FOUND");
  assert.equal(detectCoverLetterUploadInputs(page(upload("Resume or cover letter"))).length, 0);
});

test("a file the upload already holds is not attached again", () => {
  const document = page(upload("Resume"));
  const first = attachResumePayload(payload("Jane Resume.pdf"), document);
  assert.equal(first.code, "RESUME_ATTACHED");
  const again = attachResumePayload(payload("Jane Resume.pdf"), document);
  assert.equal(again.status, "ATTACHED");
  assert.equal(again.code, "RESUME_ALREADY_ATTACHED");
});

test("the finish summary names each document's outcome", () => {
  assert.deepEqual(documentParts({ resume: { status: "ATTACHED" }, coverLetter: { status: "ATTACHED" } }), { parts: ["resume attached", "cover letter attached"], attention: false });
  assert.deepEqual(documentParts({ resume: { status: "UNSUPPORTED", code: "RESUME_INPUT_NOT_FOUND" } }), { parts: ["attach the resume yourself"], attention: true });
  assert.deepEqual(documentParts({ coverLetter: { status: "UNSUPPORTED", code: "COVER_LETTER_NOT_FOUND" } }), { parts: ["no cover letter on file"], attention: false });
  assert.deepEqual(documentParts({}), { parts: [], attention: false });
});

test("the cover letter file is loaded for attaching: a generated PDF as is, an original upload from its private link", async (t) => {
  const { loadApplicationCoverLetterFile } = await import("../extension/services/application-service.js");
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } };
  const applicationId = "00000000-0000-4000-8000-000000000021";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { kind: "TAILORED", filename: "Jordan Lee Cover Letter", mimeType: "application/pdf", contentBase64: "JVBERi0xLjQ=" } }), { status: 200 });
  assert.deepEqual(await loadApplicationCoverLetterFile(client, "https://api.example.com", applicationId),
    { base64: "JVBERi0xLjQ=", filename: "Jordan Lee Cover Letter.pdf", mimeType: "application/pdf", fileSizeBytes: 8 });

  const data = { source: "ORIGINAL_UPLOAD", kind: "BASE", filename: "Original.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signedUrl: "https://project.supabase.co/storage/v1/object/sign/cover-letters/owner/original.docx?token=example" };
  globalThis.fetch = async () => new Response(JSON.stringify({ data }), { status: 200 });
  let fetched;
  const file = await loadApplicationCoverLetterFile(client, "https://api.example.com", applicationId, async (url, options) => { fetched = { url, credentials: options.credentials }; return new Response("hello"); });
  assert.deepEqual(fetched, { url: data.signedUrl, credentials: "omit" });
  assert.deepEqual(file, { base64: Buffer.from("hello").toString("base64"), filename: "Original.docx", mimeType: data.mimeType, fileSizeBytes: 5 });

  data.signedUrl = "https://evil.example.com/storage/v1/object/sign/other/x.docx";
  await assert.rejects(() => loadApplicationCoverLetterFile(client, "https://api.example.com", applicationId, async () => assert.fail("must not fetch")), /metadata is invalid/);
});
