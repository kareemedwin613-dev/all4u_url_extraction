import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildApplicationResumeDownloadFilename } from "../extension/services/application-service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("v3.52 builds human-readable Application resume download filenames", () => {
  const sql = read("../supabase/migrations/202609021116_v3_52_application_resume_download_filename.sql");
  assert.match(sql, /application_resume_download_filename_v352/);
  assert.match(sql, /btrim\(p_candidate_name\) \|\| ' Resume'/);
  assert.match(sql, /get_application_resume_download_v17/);
});

test("v3.56 includes Application number in download filename", () => {
  const sql = read("../supabase/migrations/202609031142_v3_56_resume_download_application_id.sql");
  assert.match(sql, /application_resume_download_filename_v352/);
  assert.match(sql, /p_application_number/);
  assert.match(sql, /App /);
  assert.match(sql, /applicationNumber/);
});

test("buildApplicationResumeDownloadFilename prefers candidate name plus Resume extension", () => {
  assert.equal(
    buildApplicationResumeDownloadFilename({
      candidateName: "Andrew Thomas",
      resumeName: "Andrew Thomas Resume",
      filename: "resume-33-application-13994-tailored.pdf",
      mimeType: "application/pdf",
    }),
    "Andrew Thomas Resume.pdf",
  );
  assert.equal(
    buildApplicationResumeDownloadFilename({
      resumeName: "Andrew Thomas Resume",
      filename: "resume-33-application-13994-tailored.pdf",
      mimeType: "application/pdf",
    }),
    "Andrew Thomas Resume.pdf",
  );
});

test("buildApplicationResumeDownloadFilename includes Application number when provided", () => {
  assert.equal(
    buildApplicationResumeDownloadFilename({
      candidateName: "Andrew Thomas",
      resumeName: "Andrew Thomas Resume",
      filename: "resume-33-application-13994-tailored.pdf",
      mimeType: "application/pdf",
      applicationNumber: 42,
    }),
    "Andrew Thomas Resume - App 42.pdf",
  );
  assert.equal(
    buildApplicationResumeDownloadFilename({
      resumeName: "My Resume",
      mimeType: "application/pdf",
      applicationNumber: 7,
    }),
    "My Resume - App 7.pdf",
  );
  assert.equal(
    buildApplicationResumeDownloadFilename({
      candidateName: "Jane Doe",
      mimeType: "application/pdf",
      applicationNumber: null,
    }),
    "Jane Doe Resume.pdf",
  );
});

test("attached Resumes are named '<Candidate> Resume' without the Application number; downloads keep it", async () => {
  const { loadApplicationResumeForSession } = await import("../extension/services/application-service.js");
  const client = {
    rpc: async () => ({ data: { bucket: "resumes", path: "a/b.pdf", filename: "upload.pdf", resumeNumber: 7, resumeType: "TAILORED", mimeType: "application/pdf", fileSizeBytes: 1200, candidateName: "Jane Doe", applicationNumber: 482 }, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage.example.com/signed" }, error: null }) }) },
  };
  let sent;
  await loadApplicationResumeForSession(client, "", { id: "session", applicationId: "application" }, async (message) => { sent = message; return { ok: true, data: { ready: true } }; });
  assert.equal(sent.payload.access.filename, "Jane Doe Resume.pdf");
  assert.equal(buildApplicationResumeDownloadFilename({ candidateName: "Jane Doe", mimeType: "application/pdf", applicationNumber: 482 }), "Jane Doe Resume - App 482.pdf");
});

test("downloads are named '<Candidate> Resume - <Company>', falling back to the Application number", async () => {
  const name = (companyName) => buildApplicationResumeDownloadFilename({ candidateName: "Jane Doe", mimeType: "application/pdf", applicationNumber: 482, companyName });
  assert.equal(name("Elite Technology"), "Jane Doe Resume - Elite Technology.pdf");
  assert.equal(name("Acme, Inc."), "Jane Doe Resume - Acme Inc.pdf");
  assert.equal(name("AT&T"), "Jane Doe Resume - AT T.pdf");
  assert.equal(name("  "), "Jane Doe Resume - App 482.pdf", "no company recorded");
  const { downloadApplicationResume } = await import("../extension/services/application-service.js");
  const client = {
    rpc: async () => ({ data: { bucket: "resumes", path: "a/b.pdf", filename: "upload.pdf", resumeNumber: 7, resumeType: "TAILORED", mimeType: "application/pdf", fileSizeBytes: 1200, candidateName: "Jane Doe", applicationNumber: 482 }, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage.example.com/signed" }, error: null }) }) },
  };
  let options;
  const result = await downloadApplicationResume(client, "", "application", async (value) => { options = value; return 3; }, { companyName: "Elite Technology" });
  assert.equal(options.filename, "Jane Doe Resume - Elite Technology.pdf");
  assert.equal(result.downloadName, "Jane Doe Resume - Elite Technology.pdf");
  assert.equal(options.conflictAction, "uniquify", "a second download for the same company gets Chrome's (1) suffix");
});

test("My Applications passes the Application's company to Download Resume", () => {
  assert.match(read("../extension/sidepanel/views/MyApplicationsView.jsx"), /downloadApplicationResume\(client, backendBaseUrl, application\.id, undefined, \{ companyName: application\.company \}\)/);
});
