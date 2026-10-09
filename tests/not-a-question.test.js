import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { detectUnresolvedQuestions } from "../extension/autofill/screening-field-adapter.js";
import { notAQuestion } from "../extension/autofill/form-context.js";
import { contactQuestion, personalFieldCandidates } from "../extension/autofill/personal-field-adapter.js";

function page(body) {
  const { document, window } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}

test("cookie banners, option-only groups and generic control labels are not reported as questions", () => {
  const document = page(`
    <div id="onetrust-consent-sdk"><div class="ot-pc-content">
      <label><input type="checkbox" id="ot-group-id-C0004"> Targeting Cookies</label>
      <label><input type="checkbox" id="ot-group-id-C0002"> Performance Cookies</label></div></div>
    <form>
      <div><label><input type="radio" name="q9" value="no"> No</label><label><input type="radio" name="q9" value="yes"> Yes</label></div>
      <div><input type="checkbox" name="agree" aria-label="checkbox label"></div>
      <div><label for="hybrid">Are you open to a hybrid schedule, 3 days in office?</label><select id="hybrid"><option>Yes</option><option>No</option></select></div>
      <div><label for="why">Why do you want to work here?</label><textarea id="why"></textarea></div>
    </form>`);
  const questions = detectUnresolvedQuestions(document).map((item) => item.question);
  assert.deepEqual(questions, ["Are you open to a hybrid schedule, 3 days in office?", "Why do you want to work here?"]);
});

test("the not-a-question check keeps real questions", () => {
  for (const text of ["Yes", "No Yes", "I agree", "checkbox label", "Targeting Cookies", "Select", "Search", "N/A"]) assert.equal(notAQuestion(text), true, text);
  for (const text of ["Which best describes you?", "Have you been referred to us? *", "Are you open to contract roles?", "Location", "Yes, I'd relocate for the right role?"]) {
    assert.equal(notAQuestion(text) && !/cookie/i.test(text), false, text);
  }
});

test("a short 'What is your …?' contact question is filled by the contact rules, not sent to AI", () => {
  assert.equal(contactQuestion("What is your preferred name?*"), true);
  assert.equal(contactQuestion("Please provide the name of the individual(s) who referred you."), false, "a referrer's name is not the candidate's");
  const document = page(`<form><label for="pn">What is your preferred name?*</label><input type="text" id="pn" name="q_pref"></form>`);
  assert.deepEqual(personalFieldCandidates(document, ["candidate.fullName", "candidate.firstName"]).map((candidate) => candidate.key), ["candidate.fullName"]);
});

test("v3.163 removes only learned rows that were never questions", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610082100_v3_163_remove_non_question_learned_wordings.sql", import.meta.url), "utf8");
  assert.match(sql, /delete from public\.autofill_learned_wordings\s+where target_key = 'none'/, "rows mapped to a real answer are kept");
  assert.ok(sql.includes(String.raw`'\mcookies?\M'`));
});
