import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { detectUnresolvedQuestions } from "../extension/autofill/screening-field-adapter.js";
import { AI_DRAFT_ATTRIBUTE, fillDraftFields } from "../extension/autofill/draft-fill.js";
import { selectJobSiteAdapter } from "../extension/adapters/adapter-registry.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function page() {
  const { document, window } = parseHTML(`<!doctype html><html><body><form>
    <label for="why">Why do you want to work at Acme?</label><textarea id="why"></textarea>
    <label for="motto">In one line, what drives you?</label><input id="motto" type="text" maxlength="120">
    <fieldset><legend>Are you open to contract roles?</legend><label><input type="radio" name="c" value="y">Yes</label><label><input type="radio" name="c" value="n">No</label></fieldset>
    <label for="cert">I certify that the information I provided is true</label><textarea id="cert"></textarea>
  </form></body></html>`);
  window.Element.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, { Event: window.Event, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  return document;
}

test("unanswered text boxes carry a reference and their length limit; choices and blocked statements do not", () => {
  const document = page();
  const byQuestion = Object.fromEntries(detectUnresolvedQuestions(document).map((item) => [item.question, item]));
  const why = byQuestion["Why do you want to work at Acme?"], motto = byQuestion["In one line, what drives you?"];
  assert.match(why.ref, /^u[a-z0-9]+_\d+$/);
  assert.equal(document.getElementById("why").getAttribute("data-resume-jd-unresolved-ref"), why.ref);
  assert.equal(motto.maxLength, 120);
  assert.equal(byQuestion["Are you open to contract roles?"].ref, undefined);
  const cert = Object.values(byQuestion).find((item) => /certify/.test(item.question));
  assert.equal(cert?.ref, undefined, "legal statements are never drafted");
});

test("a drafted answer goes into exactly its box, keeps line breaks, and is outlined until a person edits it", async () => {
  const document = page();
  const why = detectUnresolvedQuestions(document).find((item) => /Acme/.test(item.question));
  const [result] = fillDraftFields([{ fieldId: `draft_${why.ref}`, key: `draft.${why.ref}`, value: "I led payments at Initech.\n\nAcme's platform is the next step." }], document);
  const box = document.getElementById("why");
  assert.equal(result.status, "VERIFIED");
  assert.equal(box.value, "I led payments at Initech.\n\nAcme's platform is the next step.");
  assert.equal(box.getAttribute(AI_DRAFT_ATTRIBUTE), "true");
  assert.match(box.getAttribute("style") || "", /dashed/);
  assert.deepEqual(fillDraftFields([{ fieldId: "x", key: "draft.missing_ref", value: "Hi there" }], document).map((item) => item.code), ["FIELD_NOT_FOUND"]);
  assert.deepEqual(fillDraftFields([{ fieldId: "x", key: 'draft."]),*', value: "Hi" }], document).map((item) => item.code), ["FIELD_NOT_FOUND"], "references are never used as raw selectors");
});

test("the generic adapter fills draft fields alongside the others", async () => {
  const document = page();
  const why = detectUnresolvedQuestions(document).find((item) => /Acme/.test(item.question));
  const { adapter } = selectJobSiteAdapter("https://jobs.example.com/apply");
  const results = await adapter.fillFields({ root: document, fields: [{ fieldId: `draft_${why.ref}`, key: `draft.${why.ref}`, value: "Because of the mission." }] });
  assert.deepEqual(results.map((item) => item.status), ["VERIFIED"]);
});

test("the side panel drafts only open-ended questions and never in recovered or review-first sessions", () => {
  const app = read("../extension/sidepanel/App.jsx");
  assert.match(app, /if \(item\.controlType === "textarea"\) return !\["SAME_FOR_EVERYONE", "NOT_A_QUESTION"\]\.includes\(kind\);/);
  assert.match(app, /return item\.controlType === "input" && kind === "ESSAY";/);
  assert.match(app, /const draftable = \(recovered \|\| reviewRequired\) \? \[\] :/);
  assert.match(app, /value: field\.draftValue \?\? autofillValue\(autofillContext, field\)/);
  const worker = read("../extension/background/service-worker.js");
  assert.match(worker, /if\(\/\^draft\\\.\[A-Za-z0-9_-\]\{1,60\}\$\/\.test\(item\.key\)&&typeof item\.value==="string"&&item\.value\.length<=6000\)/);
  assert.match(read("../extension/sidepanel/components/AutofillPreview.jsx"), /field\.aiDraft && <Tag color="magenta">AI draft: review<\/Tag>/);
});

test("v3.164: drafting context never includes contact details; only the server key records drafting spend", () => {
  const sql = read("../supabase/migrations/202610082200_v3_164_autofill_ai_drafting.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.get_autofill_draft_context_v3164"), sql.indexOf("$$;", sql.indexOf("get_autofill_draft_context_v3164")));
  assert.doesNotMatch(fn, /candidate_email|candidate_phone|linkedin_url|github_url|portfolio_url|candidate_name|address_/);
  assert.match(fn, /s\.user_id = auth\.uid\(\) and s\.action = 'AUTOFILL' and s\.expires_at > now\(\)/);
  assert.match(fn, /coalesce\(\(p\.autofill_preferences->>'allowProfileFields'\)::boolean, false\)/, "same consent as profile Autofill");
  assert.match(sql, /grant execute on function public\.record_autofill_ai_draft_usage_v3164\(uuid, uuid, jsonb\) to service_role;/);
  assert.match(sql, /revoke all on function public\.record_autofill_ai_draft_usage_v3164\(uuid, uuid, jsonb\) from public, anon, authenticated;/);
});

test("open-ended questions are drafted; sensitive, legal, cover-letter and 'anything else' boxes are not", async () => {
  const { openEndedQuestion } = await import("../extension/autofill/screening-field-adapter.js");
  for (const text of ["Why do you want to work at Acme?", "Describe a project you are proud of", "Explain how you handled a production outage"]) assert.equal(openEndedQuestion(text), true, text);
  for (const text of ["Describe your gender identity", "Explain any criminal convictions", "I certify and attest that…", "Cover letter", "Anything else you would like to share?", "Additional information"]) assert.equal(openEndedQuestion(text), false, text);
  const document = page();
  const why = detectUnresolvedQuestions(document).find((item) => /Acme/.test(item.question));
  assert.equal(why.reason, "REVIEW_REQUIRED", "never filled from a stored answer");
  assert.equal(why.openEnded, true, "but drafted for a person to review");
  assert.match(read("../extension/sidepanel/App.jsx"), /&& \(item\.openEnded \|\| \(item\.reason === "NO_MATCHING_ANSWER" && shouldDraft\(/);
});
