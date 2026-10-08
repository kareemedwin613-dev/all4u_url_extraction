import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getApplicationResumeAccess, loadApplicationResumeForSession } from "../extension/services/application-service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

function tailoredClient(calls = []) {
  return {
    rpc: async (name, args) => {
      calls.push({ type: "rpc", name, args });
      return { data: { bucket: "tailored-resumes", path: "owner/job/file.pdf", filename: "tailored-7f3a.pdf", candidateName: "Andrew Thomas", resumeNumber: 42, resumeType: "TAILORED", mimeType: "application/pdf", fileSizeBytes: 1234, applicationNumber: 42 }, error: null };
    },
    storage: { from: (bucket) => ({ createSignedUrl: async (path, expires) => {
      calls.push({ type: "signedUrl", bucket, path, expires });
      return { data: { signedUrl: `https://project.supabase.co/storage/v1/object/sign/${bucket}/${path}` }, error: null };
    } }) },
  };
}

test("attach access resolves the attached TAILORED Resume with the candidate-facing filename", async () => {
  const calls = [], before = Date.now();
  const access = await getApplicationResumeAccess(tailoredClient(calls), "https://api.example.com", "7c0bcc36-feb5-4bf3-872c-aca688def302");
  assert.equal(access.resumeType, "TAILORED");
  assert.equal(access.downloadName, "Andrew Thomas Resume - App 42.pdf");
  assert.equal(access.signedUrl, "https://project.supabase.co/storage/v1/object/sign/tailored-resumes/owner/job/file.pdf");
  const expiresAt = Date.parse(access.expiresAt);
  assert.ok(expiresAt >= before + 90_000 && expiresAt <= Date.now() + 90_000, "expiry is measured from the request, never beyond the signed URL lifetime");
  assert.deepEqual(calls.map((call) => call.type), ["rpc", "signedUrl"]);
  assert.equal(calls[0].name, "get_application_resume_download_v17");
});

test("session load hands the worker the candidate filename and retries once with a fresh URL on expiry", async () => {
  const calls = [], messages = [];
  const session = { id: "a3c1c0de-1111-4111-8111-111111111111", applicationId: "7c0bcc36-feb5-4bf3-872c-aca688def302" };
  const loaded = await loadApplicationResumeForSession(tailoredClient(calls), "https://api.example.com", session, async (message) => {
    messages.push(message);
    return messages.length === 1 ? { ok: false, error: { code: "RESUME_ACCESS_EXPIRED", message: "expired" } } : { ok: true, data: { ready: true, filename: message.payload.access.filename } };
  });
  // Employers see the attached file, so it carries no internal Application number.
  assert.equal(loaded.filename, "Andrew Thomas Resume.pdf");
  assert.equal(messages.length, 2);
  assert.equal(calls.filter((call) => call.type === "signedUrl").length, 2, "each attempt uses a newly signed URL");
  assert.deepEqual(Object.keys(messages[0].payload).sort(), ["access", "applicationId", "sessionId"]);

  const failing = async () => ({ ok: false, error: { code: "RESUME_LOAD_FAILED", message: "The private Resume could not be loaded." } });
  await assert.rejects(() => loadApplicationResumeForSession(tailoredClient(), "https://api.example.com", session, failing), (error) => error.code === "RESUME_LOAD_FAILED");
});

test("service worker loads panel-resolved access for Attach Resume and Autofill sessions", () => {
  const worker = read("../extension/background/service-worker.js");
  assert.match(worker, /RESUME_ACTIONS=new Set\(\["LOAD_RESUME","AUTOFILL"\]\)/);
  assert.match(worker, /SAFE_RESUME_FILENAME/);
  assert.match(worker, /downloadResumeBytes\(\{signedUrl:access\.signedUrl/);
  // Attachment waits for the tracked tab and refuses a tab that navigated to another origin.
  assert.match(worker, /const tab=await waitForTrackedTab\(active\.targetTabId\);if\(!tab\?\.id\|\|restricted\(tab\.url\)\|\|!await ensureOrigin\(tab\)\)return fail\("SITE_ACCESS_DENIED"[^;]*;if\(active\.targetOrigin&&new URL\(tab\.url\)\.origin!==active\.targetOrigin\)return fail\("RESUME_TARGET_ORIGIN_CHANGED"/);
  // Panel-started sessions act on the tab the Applier is looking at, not a re-opened job posting.
  assert.match(worker, /const preferCurrent=internal,/);
});

test("side panel attaches the Resume in one click and before Autofill field detection", () => {
  const app = read("../extension/sidepanel/App.jsx"), card = read("../extension/sidepanel/components/ApplicationCard.jsx");
  assert.match(card, /onExtensionAction\(application,"LOAD_RESUME"\)\}>Attach Resume</);
  assert.match(card, /Download Resume/);
  assert.match(app, /loadApplicationResumeForSession/);
  assert.doesNotMatch(app, /accessToken: session\.access_token|signedUrl/);
  const autofill = app.slice(app.indexOf("// Everything the page needs is requested at once"));
  assert.ok(autofill.indexOf("attachSessionResume(") > -1 && autofill.indexOf("attachSessionResume(") < autofill.indexOf("PREPARE_PERSONAL_AUTOFILL"), "Resume is attached before fields are detected");
  // Review-required Resumes and recovered sessions are loaded but not re-uploaded automatically.
  assert.match(app, /if \(!attachment && !recovered && !reviewRequired\) \{\s*tabProgress\(id, 2, steps, "Attaching resume"\);\s*try \{\s*attachment = await attachSessionResume/);
  assert.match(app, /attachmentsRef\.current\.get\(id\)/);
  assert.doesNotMatch(app, /\.submit\(|requestSubmit\(/);
});
