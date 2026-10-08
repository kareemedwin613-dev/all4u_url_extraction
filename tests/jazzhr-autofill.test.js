import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { attachResumePayload, revealResumeInput } from "../extension/autofill/resume-upload-adapter.js";
import { detectPersonalFields } from "../extension/autofill/personal-field-adapter.js";
import { findBestOption } from "../extension/autofill/option-matching.js";

// JazzHR keeps the Resume input hidden until "Attach resume" (rather than "Paste resume") is chosen.
function jazzPage(attachHref = "#") {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <label for="resumator-address-value">Address</label><input id="resumator-address-value" type="text" placeholder="Address">
    <label for="resumator-email-value">Email Address</label><input id="resumator-email-value" type="email">
    <div id="resumator-resume"><label for="resumator-resume-value">Resume*</label>
      <div id="options"><a id="choose-upload" href="${attachHref}">Attach resume</a> or <a id="choose-paste" href="#">Paste resume</a></div>
      <div id="upload-wrapper" hidden><input type="file" id="resumator-resume-value" name="resumator-resume-value"></div></div>
  </form></body></html>`);
  Object.assign(globalThis, { Event: window.Event, DataTransfer: undefined });
  const wrapper = document.getElementById("upload-wrapper"), input = document.getElementById("resumator-resume-value");
  input.getClientRects = () => (wrapper.hasAttribute("hidden") ? [] : [{}]);
  let pasteClicked = false;
  document.getElementById("choose-upload").addEventListener("click", () => wrapper.removeAttribute("hidden"));
  document.getElementById("choose-paste").addEventListener("click", () => { pasteClicked = true; });
  return { document, input, wrapper, pasteClicked: () => pasteClicked };
}

test("JazzHR: the hidden Resume input is revealed through 'Attach resume', never 'Paste resume'", () => {
  const page = jazzPage();
  assert.equal(revealResumeInput(page.input), true);
  assert.equal(page.wrapper.hasAttribute("hidden"), false);
  assert.equal(page.pasteClicked(), false);
  assert.equal(revealResumeInput(page.input), false, "an already visible input needs nothing");
});

test("JazzHR: a reveal link that would navigate away is never clicked", () => {
  const page = jazzPage("/upload-resume");
  assert.equal(revealResumeInput(page.input), false);
  assert.equal(page.wrapper.hasAttribute("hidden"), true);
});

test("JazzHR: attaching reveals the input before setting the file", () => {
  const page = jazzPage(), bytes = Buffer.from("%PDF-1.4\n%%EOF\n");
  const result = attachResumePayload({ base64: bytes.toString("base64"), filename: "Jane Doe Resume.pdf", mimeType: "application/pdf", fileSizeBytes: bytes.length }, page.document);
  assert.equal(page.wrapper.hasAttribute("hidden"), false);
  assert.equal(result.code, "DATA_TRANSFER_UNAVAILABLE", "the test DOM has no DataTransfer; Chrome attaches the file");
});

test("JazzHR: a bare 'Address' label is the street address, not 'Email Address'", () => {
  const page = jazzPage();
  const fields = detectPersonalFields(page.document, ["candidate.addressLine1", "candidate.email"]);
  const byKey = Object.fromEntries(fields.map((field) => [field.key, field.label]));
  assert.equal(byKey["candidate.addressLine1"], "Address");
  assert.match(byKey["candidate.email"], /^Email Address/);
});

test("JazzHR: citizenship eligibility picks the U.S. citizen option, and v3.160 adds the wordings", async () => {
  const options = ["No answer", "I am a U.S. Citizen/Permanent Resident", "Non-citizen allowed to work for any employer", "Non-citizen seeking work authorization"].map((text) => ({ text }));
  assert.equal(findBestOption(options, "U.S. citizen", (item) => [item.text]).text, "I am a U.S. Citizen/Permanent Resident");
  const sql = await readFile(new URL("../supabase/migrations/202610071200_v3_160_guide_citizenship_residence_wordings.sql", import.meta.url), "utf8");
  assert.match(sql, /'What is your work authorization%',\s*array\['citizenship \/ employment eligibility'/);
  assert.match(sql, /'What does%mean in Personal Details%',\s*array\['city and state do you reside'/);
  assert.match(sql, /cardinality\(autofill_patterns\) \+ cardinality\(p_wordings\) <= 20/);
});

test("Workable: an unlabeled upload marked data-ui=\"resume\" is the Resume input", async () => {
  const { detectResumeUploadInputs } = await import("../extension/autofill/resume-upload-adapter.js");
  const { document } = parseHTML(`<form><div data-role="dropzone"><label for="f1">Choose file</label><input type="file" id="f1" data-ui="resume"></div>
    <div><label for="f2">Choose file</label><input type="file" id="f2" data-ui="cover_letter"></div></form>`);
  assert.deepEqual(detectResumeUploadInputs(document).map((item) => item.input.id), ["f1"]);
});
