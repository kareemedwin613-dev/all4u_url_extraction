import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { attachResumeFile, detectResumeUploadInputs, manualResumeFallback, scoreResumeUploadInput, validateResumeFile, verifyResumeUpload } from "../extension/autofill/resume-upload-adapter.js";

function fakeInput({ name = "", label = "", accept = ".pdf,.docx", multiple = false, disabled = false, parent = "" } = {}) {
  const events = [];
  return {
    type: "file", name, id: "", accept, multiple, disabled, required: false, files: [], labels: label ? [{ textContent: label }] : [],
    parentElement: { textContent: parent || label },
    getAttribute: () => "", closest: () => null,
    dispatchEvent: (event) => { events.push(event.type); return true; },
    scrollIntoView: () => {}, focus: () => {}, events,
  };
}

test("v0.8.7 detects Resume/CV inputs and excludes cover-letter or generic upload inputs", () => {
  const resume = fakeInput({ name: "candidate_resume", label: "Upload résumé" });
  const cv = fakeInput({ label: "Curriculum Vitae", accept: "application/pdf" });
  const cover = fakeInput({ name: "cover_letter", label: "Cover letter" });
  const generic = fakeInput({ label: "Supporting document" });
  const detected = detectResumeUploadInputs({ querySelectorAll: () => [generic, cover, cv, resume] });
  assert.equal(detected.length, 2);
  assert.equal(detected.some(({ input }) => input === resume), true);
  assert.equal(detected.some(({ input }) => input === cv), true);
  assert.ok(scoreResumeUploadInput(resume) >= 90);
  assert.equal(scoreResumeUploadInput(cover), -1);
});

test("v0.8.7 validates size, extension, MIME type, and the input accept list", () => {
  const input = fakeInput({ accept: ".pdf" });
  assert.equal(validateResumeFile({ name: "resume.pdf", type: "application/pdf", size: 1000 }, input).valid, true);
  assert.equal(validateResumeFile({ name: "resume.exe", type: "application/octet-stream", size: 1000 }, input).code, "RESUME_FILE_TYPE_UNSUPPORTED");
  assert.equal(validateResumeFile({ name: "resume.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1000 }, input).code, "RESUME_INPUT_REJECTS_FILE");
  assert.equal(validateResumeFile({ name: "resume.pdf", type: "application/pdf", size: 6 * 1024 * 1024 }, input).code, "RESUME_FILE_SIZE_INVALID");
});

test("v0.8.7 attaches through DataTransfer, dispatches both events, and verifies the file", () => {
  const originalDataTransfer = globalThis.DataTransfer;
  globalThis.DataTransfer = class { constructor() { this.files = []; this.items = { add: (file) => { this.files = [file]; } }; } };
  try {
    const input = fakeInput({ name: "resume", label: "Resume" }), file = { name: "resume.pdf", type: "application/pdf", size: 1000 };
    const result = attachResumeFile(input, file);
    assert.equal(result.status, "ATTACHED");
    assert.deepEqual(input.events, ["input", "change"]);
    assert.equal(verifyResumeUpload(input, file), true);
  } finally { globalThis.DataTransfer = originalDataTransfer; }
});

test("v0.8.7 provides a safe manual fallback when programmatic attachment is unavailable", () => {
  let focused = false, scrolled = false;
  const input = fakeInput({ label: "Resume" });
  input.focus = () => { focused = true; }; input.scrollIntoView = () => { scrolled = true; };
  const result = manualResumeFallback(input, "PROGRAMMATIC_ATTACHMENT_BLOCKED");
  assert.equal(result.status, "MANUAL_REQUIRED");
  assert.equal(focused, true); assert.equal(scrolled, true);
  assert.match(result.message, /file chooser/i);
});

test("v0.8.7 injects only into the tracked tab and never submits the application", async () => {
  const [worker, content, adapter, app, build] = await Promise.all([
    readFile(new URL("../extension/background/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/content/resume-upload.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/autofill/resume-upload-adapter.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/sidepanel/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /chrome\.tabs\.get\(active\.targetTabId\)/);
  assert.match(worker, /files:\["content\/resume-upload\.js"\]/);
  assert.match(content, /ATTACH_RESUME_TO_PAGE/);
  assert.match(adapter, /DataTransfer/);
  assert.match(adapter, /dispatchEvent\(new Event\("input"/);
  assert.match(adapter, /dispatchEvent\(new Event\("change"/);
  assert.match(app, /Attach Resume to Page/);
  assert.match(build, /content\/resume-upload/);
  assert.doesNotMatch(worker + content + adapter + app, /\.submit\(|requestSubmit\(|click\(\).*submit/is);
});
