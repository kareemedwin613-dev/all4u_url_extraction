import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ApplicationService } from "../src/applications/application.service.js";
import { RecordApplicationAutofillTelemetryDto, RecordAutofillUnresolvedQuestionsDto } from "../src/applications/application.dto.js";
import { ApplicationGuideService } from "../src/application-guide/application-guide.service.js";
import { SaveApplicationGuideDto } from "../src/application-guide/application-guide.dto.js";
import { CandidateService } from "../src/candidates/candidate.service.js";
import { ResumeGenderDto } from "../src/candidates/candidate.dto.js";

const user = { id: "user", token: "jwt", email: "a@example.com" } as any;
function supabase(calls: any[], data: any = { id: "00000000-0000-4000-8000-000000000001" }) {
  return { forUser: (token: string) => ({ rpc: async (name: string, args: any) => { calls.push({ token, name, args }); return { data, error: null }; } }) } as any;
}

test("v3.157 accepts guide field keys in Autofill outcome telemetry", async () => {
  const body = plainToInstance(RecordApplicationAutofillTelemetryDto, {
    resumeUpdatedAt: "2026-10-06T00:00:00Z", adapterId: "generic-html", adapterVersion: "2.0.0", targetDomain: "jobs.example.com",
    detectedCount: 1, selectedCount: 1, succeededCount: 1, failedCount: 0, unresolvedCount: 0,
    fields: [{ fieldKey: "guide.00000000-0000-4000-8000-000000000001", fieldIndex: 0, confidence: 99, outcome: "VERIFIED" }],
  });
  assert.deepEqual(await validate(body), []);
});

test("v3.157 records unanswered question wording through the user's session without answers", async () => {
  const calls: any[] = [], service = new ApplicationService(supabase(calls));
  const body = plainToInstance(RecordAutofillUnresolvedQuestionsDto, { targetDomain: "jobs.example.com", adapterId: "greenhouse", questions: [{ question: "Why do you want to work here?", controlType: "textarea", reason: "NO_MATCHING_ANSWER" }] });
  assert.deepEqual(await validate(body), []);
  const invalid = plainToInstance(RecordAutofillUnresolvedQuestionsDto, { questions: [{ question: "Q?", controlType: "file", reason: "ANSWERED", answer: "secret" }] });
  assert.ok((await validate(invalid)).length > 0);
  await service.recordUnresolvedQuestions(user, "00000000-0000-4000-8000-000000000002", body);
  assert.equal(calls[0].token, "jwt");
  assert.equal(calls[0].name, "record_autofill_unresolved_questions_v3157");
  assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_adapter_id", "p_questions", "p_session_id", "p_target_domain"]);
});

test("v3.157 saves a guide entry's Autofill rule separately from its published content", async () => {
  const calls: any[] = [], service = new ApplicationGuideService(supabase(calls));
  const body = plainToInstance(SaveApplicationGuideDto, { question: "Are you willing to relocate?", meaning: "Move cities.", howToAnswer: "No.", status: "PUBLISHED", autofill: { mode: "FIXED", value: "No", patterns: ["willing to relocate"] } });
  assert.deepEqual(await validate(body), []);
  await service.save(user, body);
  assert.deepEqual(calls.map((call) => call.name), ["save_application_guide_v3149", "save_application_guide_autofill_v3157"]);
  assert.equal(calls[1].args.p_mode, "FIXED");
  assert.equal(calls[1].args.p_source, null);
  const badSource = plainToInstance(SaveApplicationGuideDto, { question: "Q", meaning: "M", howToAnswer: "H", status: "DRAFT", autofill: { mode: "DERIVED", source: "resume_text" } });
  assert.ok((await validate(badSource)).length > 0);
});

test("v3.157 sets gender only through the Resume gender RPC with allowed values", async () => {
  const calls: any[] = [], service = new CandidateService(supabase(calls));
  assert.deepEqual(await validate(plainToInstance(ResumeGenderDto, { gender: "FEMALE" })), []);
  assert.deepEqual(await validate(plainToInstance(ResumeGenderDto, { gender: null })), []);
  assert.ok((await validate(plainToInstance(ResumeGenderDto, { gender: "UNKNOWN" }))).length > 0);
  await service.updateGender(user, "00000000-0000-4000-8000-000000000003", "FEMALE");
  assert.deepEqual(calls[0], { token: "jwt", name: "update_resume_gender_v3157", args: { p_resume_id: "00000000-0000-4000-8000-000000000003", p_gender: "FEMALE" } });
});

test("v3.166 an Admin corrects a learned wording through their own session; bad targets never reach the database", async () => {
  const { CorrectLearnedWordingDto } = await import("../src/application-guide/application-guide.dto.js");
  const calls: any[] = [], service = new ApplicationGuideService(supabase(calls, { id: "w1", targetKey: "field.linkedInUrl", answerKind: null }));
  await service.correctLearnedWording(user, "00000000-0000-4000-8000-000000000009", { targetKey: "field.linkedInUrl" });
  assert.deepEqual(calls[0], { token: "jwt", name: "correct_autofill_learned_wording_v3166", args: { p_id: "00000000-0000-4000-8000-000000000009", p_target_key: "field.linkedInUrl", p_answer_kind: null } });
  for (const body of [{ targetKey: "field.linkedInUrl" }, { targetKey: "none", answerKind: "ESSAY" }, { targetKey: "guide.00000000-0000-4000-8000-000000000001" }]) {
    assert.deepEqual(await validate(plainToInstance(CorrectLearnedWordingDto, body)), [], JSON.stringify(body));
  }
  for (const body of [{ targetKey: "candidate.linkedInUrl" }, { targetKey: "none", answerKind: "ANYTHING" }, { targetKey: "field.linked in" }]) {
    assert.ok((await validate(plainToInstance(CorrectLearnedWordingDto, body))).length > 0, JSON.stringify(body));
  }
});
