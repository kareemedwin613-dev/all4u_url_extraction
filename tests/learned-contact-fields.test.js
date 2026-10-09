import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { contactQuestion, personalFieldCandidates } from "../extension/autofill/personal-field-adapter.js";
import { addRecognizedWordings } from "../extension/autofill/autofill-context.js";

const sql = readFileSync(new URL("../supabase/migrations/202610091100_v3_166_correct_learned_wordings.sql", import.meta.url), "utf8");
function page(label) {
  const { document, window } = parseHTML(`<!doctype html><html><body><form><label for="f">${label}</label><input id="f" type="text"></form></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  return document;
}
const keys = ["candidate.linkedInUrl", "candidate.currentLocation", "candidate.githubUrl"];

test("'LinkedIn Profile: Please provide the URL…' is the LinkedIn field, not an essay for AI", () => {
  const label = "LinkedIn Profile: Please provide the URL to your professional profile.*";
  assert.deepEqual(personalFieldCandidates(page(label), keys).map((item) => [item.key, item.confidence]), [["candidate.linkedInUrl", 90]]);
  assert.equal(contactQuestion(label), true, "never sent to AI recognition or drafting");
});

test("a label before a colon counts only when an instruction follows, never a question", () => {
  assert.deepEqual(personalFieldCandidates(page("Location: Are you open to relocating to Austin for this role?"), keys), []);
  assert.equal(contactQuestion("Location: Are you open to relocating to Austin for this role?"), false);
  assert.deepEqual(personalFieldCandidates(page("GitHub: please include a link to your public work"), keys).map((item) => item.key), ["candidate.githubUrl"]);
});

test("a contact-field wording learned by AI or corrected by an Admin fills that field", () => {
  const document = page("Where can we see your professional networking page?");
  assert.deepEqual(personalFieldCandidates(document, keys), [], "the rules alone do not know this wording");
  const recognized = { asked: [{ question: "Where can we see your professional networking page?*" }], results: [{ index: 0, targetKey: "field.linkedInUrl", source: "LEARNED" }] };
  const extended = addRecognizedWordings([], [], recognized);
  assert.deepEqual(extended.personalWordings, { "candidate.linkedInUrl": ["Where can we see your professional networking page?*"] });
  assert.equal(extended.count, 1, "the page is scanned again");
  assert.deepEqual(personalFieldCandidates(document, keys, extended.personalWordings).map((item) => [item.key, item.confidence]), [["candidate.linkedInUrl", 95]]);
  assert.deepEqual(personalFieldCandidates(document, ["candidate.githubUrl"], extended.personalWordings), [], "only fields this Resume can fill");
});

test("v3.166: contact fields are targets, Admins correct wordings, and the AI never overwrites a correction", () => {
  assert.match(sql, /field\\.\[A-Za-z0-9\]\{2,40\}/);
  assert.match(sql, /'linkedInUrl'/);
  assert.match(sql, /where autofill_learned_wordings\.corrected_at is null;/);
  const correct = sql.slice(sql.indexOf("create or replace function public.correct_autofill_learned_wording_v3166"));
  assert.match(correct, /public\.application_guide_admin\(\)/);
  assert.match(correct, /public\.autofill_learned_target_ok_v3161\(v_target\)/);
});
