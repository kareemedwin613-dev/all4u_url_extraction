import type { RecognizerTarget } from "./recognizer.js";

// Ten reworded questions with known right answers, for "Test this model" on the dashboard and the
// command-line try script. Employer-style wording only; no candidate data.
export const SAMPLE_TARGETS: RecognizerTarget[] = [
  { key: "guide.work-authorization", question: "Are you legally authorized to work in the United States?", wordings: ["authorized to work", "work authorization"] },
  { key: "guide.salary", question: "What are your salary expectations?", wordings: ["desired salary", "expected compensation"] },
  { key: "guide.hear-about", question: "How did you hear about us?", wordings: ["how did you hear", "referral source"] },
  { key: "guide.relocate", question: "Are you willing to relocate?", wordings: ["willing to relocate"] },
  { key: "guide.languages", question: "What languages do you speak?", wordings: ["languages"] },
  { key: "guide.github", question: "GitHub profile URL", wordings: ["github"] },
];

// [question, option labels, accepted targets]. A Guide entry and a Resume answer can ask the same thing
// (work authorization, salary); either one fills the right answer, so both are accepted.
export const SAMPLE_QUESTIONS: Array<[string, string[], string[]]> = [
  ["Can you lawfully take up employment in the US without restrictions?", ["Yes", "No"], ["guide.work-authorization", "answer.authorized_to_work"]],
  ["Will your employment here ever depend on an employer-backed visa petition?", ["Yes", "No"], ["answer.requires_sponsorship"]],
  ["What base pay range are you targeting for this role?", [], ["guide.salary", "answer.desired_salary"]],
  ["Where did you first learn about this opening?", ["LinkedIn", "Indeed", "Referral", "Other"], ["guide.hear-about"]],
  ["Would you move to Austin, TX for this position?", ["Yes", "No"], ["guide.relocate", "answer.willing_to_relocate"]],
  ["How many years of hands-on Kubernetes experience do you have?", [], ["none"]],
  ["Why are you interested in working at Acme?", [], ["none"]],
  ["Are you authorized to work in Canada?", ["Yes", "No"], ["none"]],
  ["Earliest date you could begin working with us", [], ["answer.available_start_date"]],
  ["Link to your code portfolio (GitHub, GitLab)", [], ["guide.github"]],
];
