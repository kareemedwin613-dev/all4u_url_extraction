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
