// Drafts answers to open-ended application questions from the Application's Resume and the job description.
// The model sees Resume content and the job, never the candidate's name, email, phone, address or links
// (they are not loaded, and any that appear inside text are replaced first). A person reviews every draft
// on the page before submitting; drafts are not stored.
import type { ProviderId } from "./model-catalog.js";
import { structuredCall, type Usage } from "./recognizer.js";

export interface DraftQuestion { index: number; question: string; controlType: "input" | "textarea"; maxLength?: number }
export interface DraftAnswer { index: number; answer: string }

const INSTRUCTIONS = [
  "You write answers to job-application questions on behalf of the candidate, in the first person, for a person to review before submitting.",
  "Use the candidate's Resume and the job description. Facts about the candidate's employers, job titles, dates, degrees, schools and certifications must match the Resume exactly; never add employers, degrees or certifications.",
  "You may give concrete, plausible examples and specifics consistent with the Resume to make an answer vivid.",
  "Tailor each answer to this company and role where the question allows. Be professional, warm and direct.",
  "Plain text only: no markdown, no headings, no greetings or sign-offs, no placeholders such as [Company].",
  "Length: for a text box (textarea) about 80-150 words unless the question asks for less; for a one-line input one sentence of at most 35 words.",
  "Never exceed maxLength characters when it is given.",
  "Set skip to true and answer to an empty string when the question needs information you cannot know or must not invent: references or other people's details, salary history, government ids, legal statements, or anything not about the candidate's experience, motivation or fit.",
].join(" ");

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["index", "answer", "skip"],
        properties: { index: { type: "integer" }, answer: { type: "string" }, skip: { type: "boolean" } },
      },
    },
  },
};

// Contact details never leave the API, even inside free text.
export function scrubText(value: string) {
  return String(value || "")
    .replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+|\bwww\.\S+|\b(?:linkedin|github)\.com\/\S+/gi, "[link]")
    .replace(/(?:\+?\d{1,3}[\s.-]*)?\(?\d{3}\)?[\s.-]+\d{3}[\s.-]+\d{4}\b/g, "[phone]");
}
export function scrubDeep(value: any): any {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubDeep(item)]));
  return value;
}

export async function draftAnswers(
  { provider, apiKey, model, context, questions, fetchImpl = fetch, timeoutMs = 25_000 }:
  { provider: ProviderId; apiKey: string; model: string; context: { resume: unknown; job: unknown }; questions: DraftQuestion[]; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ answers: DraftAnswer[] } & Usage> {
  const { data, ...usage } = await structuredCall({
    provider, apiKey, model, instructions: INSTRUCTIONS, name: "autofill_draft_answers", schema: SCHEMA, temperature: 0.4,
    maxOutputTokens: 3000, fetchImpl, timeoutMs,
    input: JSON.stringify({ resume: scrubDeep(context.resume), job: scrubDeep(context.job), questions }),
  });
  const byIndex = new Map(questions.map((question) => [question.index, question]));
  const answers = (Array.isArray(data?.answers) ? data.answers : [])
    .filter((item: any) => Number.isInteger(item?.index) && byIndex.has(item.index) && item.skip !== true && typeof item?.answer === "string")
    .map((item: any) => {
      const question = byIndex.get(item.index)!, limit = Math.min(question.maxLength || 6000, 6000);
      // One-line inputs get one line; answers keep within the field's own limit.
      let answer = scrubText(item.answer).trim();
      if (question.controlType === "input") answer = answer.replace(/\s*\n+\s*/g, " ");
      if (answer.length > limit) answer = answer.slice(0, limit).replace(/\s+\S*$/, "").trim();
      return { index: item.index, answer };
    })
    .filter((item: DraftAnswer) => item.answer.length >= 2);
  return { answers, ...usage };
}
