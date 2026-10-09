import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { detectResumeUploadInputs, revealResumeInput } from "../extension/autofill/resume-upload-adapter.js";

// Workday's upload: a hidden file input in a drop zone with a "Select file" button; the word "Resume" is in the
// step or section heading a few levels up ("Autofill with Resume" step, "Resume/CV" on My Experience).
const dropZone = `<div data-automation-id="file-upload-drop-zone"><div><p>Drop file here</p><span>or</span>
  <button type="button" data-automation-id="select-files">Select file</button></div>
  <input type="file" data-automation-id="file-upload-input-ref" style="display:none"></div>`;
const page = (body) => {
  const { document, window } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
  window.Element.prototype.getClientRects = function () { return this.getAttribute("style")?.includes("display:none") ? [] : [{}]; };
  return document;
};

test("Workday's 'Autofill with Resume' upload is found", () => {
  const document = page(`<div data-automation-id="applyFlowPage"><h2>Autofill with Resume</h2><div><div>${dropZone}</div>
    <p>Upload either DOC, DOCX, HTML, PDF, or TXT file types (5 MB max)</p></div></div>`);
  const found = detectResumeUploadInputs(document);
  assert.equal(found.length, 1);
  assert.equal(found[0].input.getAttribute("data-automation-id"), "file-upload-input-ref");
});

test("Workday's 'Resume/CV' upload on My Experience is found", () => {
  const document = page(`<div data-automation-id="resumeSection"><h3>Resume/CV</h3><div>${dropZone}</div></div>`);
  assert.equal(detectResumeUploadInputs(document).length, 1);
});

test("an upload under a cover-letter heading, or in a section with other uploads, is not taken for the resume", () => {
  assert.equal(detectResumeUploadInputs(page(`<section><h3>Resume and cover letter</h3><div>${dropZone}</div></section>`)).length, 0);
  assert.equal(detectResumeUploadInputs(page(`<section><h3>Resume and supporting documents</h3><div>${dropZone}</div><div>${dropZone}</div></section>`)).length, 0);
  assert.equal(detectResumeUploadInputs(page(`<section><h3>Other documents</h3><div>${dropZone}</div></section>`)).length, 0);
});

test("'Select file' is never clicked: it would open the computer's file picker", () => {
  const document = page(`<div><h2>Autofill with Resume</h2><div>${dropZone}</div></div>`);
  let clicked = false;
  document.querySelector('[data-automation-id="select-files"]').addEventListener("click", () => { clicked = true; });
  revealResumeInput(document.querySelector('input[type="file"]'));
  assert.equal(clicked, false);
});
