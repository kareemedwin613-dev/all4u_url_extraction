import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildStructuredResumeSaveBody } from "../dashboard/src/features/candidates/structured-resume-save.js";
import { APP_NOTIFICATION_CONFIG, notifyFromApp } from "../dashboard/src/shared/notifications.js";

const root = new URL("../", import.meta.url);

test("structured Resume migration uses one protected atomic RPC on the resumes row", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/202607310031_v0_9_1_structured_resume_editor.sql", root),
    "utf8",
  );
  assert.match(sql, /update_resume_structured_content_v091/);
  assert.match(sql, /perform public\.assert_application_manager\(\)/);
  assert.match(sql, /update public\.resumes set structured_content=/);
  assert.match(sql, /revoke all on function public\.update_resume_structured_content_v091/);
  assert.doesNotMatch(sql, /create table/i);
});

test("dashboard exposes add remove reorder and atomic save controls", async () => {
  const source = await readFile(
    new URL("dashboard/src/features/candidates/structured-resume-editor.jsx", root),
    "utf8",
  );
  for (const text of [
    "Add experience",
    "Add education",
    "Add certification",
    "Move up",
    "Move down",
    "Remove",
    "Save Structured Resume",
    "updateResumeStructuredContent",
    "buildStructuredResumeSaveBody",
    "onNotify",
  ])
    assert.match(source, new RegExp(text));
});

test("structured Resume save body strips profile-only fields like source", () => {
  const body = buildStructuredResumeSaveBody({
    summary: "Summary",
    skills: "SQL",
    employment: [
      {
        id: "emp-1",
        company: "Acme",
        jobTitle: "Engineer",
        location: "Remote",
        startDate: "2020-01-15T00:00:00.000Z",
        endDate: null,
        isCurrent: true,
        experienceDetails: "Built APIs",
        displayOrder: 0,
        source: "RESUME_METADATA",
      },
    ],
    education: [
      {
        id: "edu-1",
        institution: "State U",
        degree: "BS",
        fieldOfStudy: "CS",
        location: "",
        startDate: "2016-01-01",
        endDate: "2020-05-01",
        gpa: "",
        details: "",
        displayOrder: 0,
        source: "RESUME_METADATA",
      },
    ],
    certifications: [
      {
        id: "cert-1",
        name: "AWS",
        issuer: "Amazon",
        issuedDate: null,
        expirationDate: null,
        credentialId: "",
        credentialUrl: "",
        source: "RESUME_METADATA",
      },
    ],
  });
  assert.equal(body.employment[0].company, "Acme");
  assert.equal(body.employment[0].startDate, "2020-01-15");
  assert.equal(body.employment[0].isCurrent, true);
  assert.equal(body.employment[0].source, undefined);
  assert.equal(body.education[0].source, undefined);
  assert.equal(body.certifications[0].source, undefined);
  assert.deepEqual(
    Object.keys(body.employment[0]).sort(),
    [
      "company",
      "displayOrder",
      "endDate",
      "experienceDetails",
      "id",
      "isCurrent",
      "jobTitle",
      "location",
      "startDate",
    ],
  );
});

test("dashboard notifications default to the bottom-right corner", async () => {
  const main = await readFile(new URL("dashboard/src/main.jsx", root), "utf8");
  const profile = await readFile(
    new URL("dashboard/src/features/candidates/candidate-profile-page.jsx", root),
    "utf8",
  );
  assert.equal(APP_NOTIFICATION_CONFIG.placement, "bottomRight");
  assert.match(main, /notification=\{APP_NOTIFICATION_CONFIG\}/);
  assert.match(profile, /notifyFromApp/);
  assert.match(profile, /notify\("success"/);
  assert.match(profile, /notify\("error"/);
  const calls = [];
  notifyFromApp(
    {
      success: (payload) => calls.push(payload),
    },
    "success",
    "Saved",
  );
  assert.equal(calls[0].message, "Saved");
  assert.equal(calls[0].placement, "bottomRight");
});
