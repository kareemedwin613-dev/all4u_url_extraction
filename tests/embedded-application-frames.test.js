import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { selectAutofillFrame, selectResumeFrame } from "../extension/background/frame-selection.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const resumeProbe = (frameId, origin, confidence) => ({ frameId, result: { origin, confidence, adapter: { id: "generic-html" } } });
const autofillProbe = (frameId, origin, fields, unresolved = 0) => ({ frameId, result: { status: "DETECTED", origin, fields: Array.from({ length: fields }, (_, index) => ({ fieldId: `f${index}` })), unresolved: Array.from({ length: unresolved }, () => ({})) } });

test("Resume attachment targets the embedded Greenhouse frame when the careers page has no Resume input", () => {
  // cribl.io/job-detail/?gh_jid=… embeds job-boards.greenhouse.io in an iframe.
  const frame = selectResumeFrame([resumeProbe(0, "https://cribl.io", -1), resumeProbe(3, "https://job-boards.greenhouse.io", 95), resumeProbe(5, "https://ads.example", -1)]);
  assert.equal(frame.frameId, 3);
});

test("Resume frame selection prefers the strongest input, keeps the top frame on ties, and rejects weak or opaque frames", () => {
  assert.equal(selectResumeFrame([resumeProbe(2, "https://a.example", 85), resumeProbe(4, "https://b.example", 95)]).frameId, 4);
  assert.equal(selectResumeFrame([resumeProbe(7, "https://ats.example", 95), resumeProbe(0, "https://careers.example", 95)]).frameId, 0);
  assert.equal(selectResumeFrame([resumeProbe(0, "https://careers.example", 60)]), null, "below the auto-attach threshold");
  assert.equal(selectResumeFrame([resumeProbe(1, "null", 95), resumeProbe(2, "about:blank", 95)]), null, "sandboxed frames have no web origin");
  assert.equal(selectResumeFrame([{ frameId: 0, result: null }, { frameId: 1 }]), null, "frames without the probe are ignored");
  assert.equal(selectResumeFrame(undefined), null);
});

test("Autofill fills the frame with the application form and falls back to the top frame when nothing is fillable", () => {
  assert.equal(selectAutofillFrame([autofillProbe(0, "https://cribl.io", 1), autofillProbe(3, "https://job-boards.greenhouse.io", 6)]).frameId, 3);
  assert.equal(selectAutofillFrame([autofillProbe(0, "https://careers.example", 4), autofillProbe(2, "https://ats.example", 4)]).frameId, 0, "ties stay in the top frame");
  assert.equal(selectAutofillFrame([autofillProbe(2, "https://ats.example", 0, 3), autofillProbe(0, "https://careers.example", 0, 1)]).frameId, 2, "unresolved questions break ties between empty frames");
  assert.equal(selectAutofillFrame([autofillProbe(2, "https://ats.example", 0), autofillProbe(0, "https://careers.example", 0)]).frameId, 0, "an empty result is reported from the top frame");
  assert.equal(selectAutofillFrame([{ frameId: 0, result: { status: "FAILED" } }]), null);
});

test("worker probes every frame, checks the chosen frame's site access, and fills the same frame it detected", () => {
  const worker = read("../extension/background/service-worker.js");
  const upload = read("../extension/content/resume-upload.js"), autofill = read("../extension/content/personal-autofill.js");
  assert.match(worker, /target:\{tabId,allFrames:true\},files:\[file\]/);
  assert.match(worker, /catch\{await chrome\.scripting\.executeScript\(\{target:\{tabId\},files:\[file\]\}\)/, "top-frame fallback when a child frame refuses injection");
  assert.match(worker, /globalThis\.__resumeJdResumeUploadProbe/);
  assert.match(upload, /globalThis\.__resumeJdResumeUploadProbe =/);
  assert.match(worker, /globalThis\.__resumeJdAutofillProbe/);
  assert.match(autofill, /globalThis\.__resumeJdAutofillProbe =/);
  assert.match(worker, /if\(!await originAllowed\(frame\.result\.origin\)\)return fail\("SITE_ACCESS_DENIED"/);
  assert.match(worker, /frame\.frameId!==0&&!await originAllowed\(result\.origin\)/);
  // Detect stores the chosen frame on that session (several tabs can run at once); fill sends to that frameId.
  assert.match(worker, /saveSession\(\{\.\.\.active,frameId:frame\.frameId\}\)/);
  assert.match(worker, /Number\.isInteger\(active\.frameId\)\?active\.frameId:0/);
  assert.match(worker, /FILL_PERSONAL_AUTOFILL_FIELDS[^;]*\{frameId\}\)/);
  assert.match(worker, /removeSessions\(item=>!id\|\|item\.id===id\)/, "reset clears one session or all");
  assert.match(worker, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\)=>\{removeSessions\(item=>item\.targetTabId===tabId\)/, "closing a tab ends its session");
  assert.doesNotMatch(worker + upload + autofill, /\.submit\(|requestSubmit\(/);
});
