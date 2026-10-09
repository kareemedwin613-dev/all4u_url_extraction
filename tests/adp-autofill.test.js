import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { fillPersonalFields, personalFieldCandidates, tagPersonalField } from "../extension/autofill/personal-field-adapter.js";

// ADP Workforce Now (workforcenow.adp.com recruitment): labels are aria-labels; the phone box follows a country
// <select> and reformats the number with the calling code; text boxes keep a value only if it arrives while focused.
function adpPage() {
  const { document, window } = parseHTML(`<!doctype html><html><body><div class="login-form-container">
    <div class="personal-info"><input id="guestFirstName" class="vdl-textbox" aria-label="First Name" type="text"></div>
    <div class="phone"><select id="phoneCountry" aria-label="Phone number country"><option value="AF">Afghanistan</option><option value="US">United States</option></select>
      <input id="phone" type="tel" aria-label="Mobile Number"></div></div></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  const first = document.getElementById("guestFirstName");
  let focused = false;
  first.focus = () => { focused = true; Object.defineProperty(document, "activeElement", { configurable: true, get: () => first }); };
  first.blur = () => { focused = false; Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body }); };
  // Leaving the box without having entered it restores its saved (empty) value.
  first.addEventListener("blur", () => { if (!focused) first.value = ""; });
  first.addEventListener("input", () => { if (!focused) first.value = ""; });
  // The phone box reformats with the calling code.
  const phone = document.getElementById("phone");
  phone.addEventListener("input", () => { const digits = phone.value.replace(/\D/g, ""); if (digits.length === 10) phone.value = `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`; });
  return document;
}

test("ADP: a text box that needs focus keeps the value", () => {
  const document = adpPage(), first = document.getElementById("guestFirstName");
  tagPersonalField(first, "f1");
  const [result] = fillPersonalFields([{ fieldId: "f1", key: "candidate.firstName", value: "Jane" }], document);
  assert.equal(first.value, "Jane");
  assert.equal(result.status, "VERIFIED");
});

test("ADP: a phone number the page reformats with +1 counts as filled", () => {
  const document = adpPage(), phone = document.getElementById("phone");
  tagPersonalField(phone, "p1");
  const [result] = fillPersonalFields([{ fieldId: "p1", key: "candidate.phone", value: "5125550142" }], document);
  assert.equal(phone.value, "+1 512 555 0142");
  assert.equal(result.status, "VERIFIED");
});

test("ADP: the phone box's label is not the neighbouring country list", () => {
  const candidates = personalFieldCandidates(adpPage(), ["candidate.phone"]);
  assert.equal(candidates[0]?.key, "candidate.phone");
  assert.doesNotMatch(candidates[0].label, /Afghanistan/);
});
