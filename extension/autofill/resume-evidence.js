// Yes/No answers to experience questions ("Do you have 9+ years of professional experience?",
// "Do you have experience with CI/CD, automated testing, and observability?") from the Resume itself.
// Rules only (agreed 2026-10-06): total years are compared with the number asked; a skill that is not on
// the Resume is answered No. Questions the rules cannot read are left for the reviewer.
import { totalYearsOfExperience } from "./autofill-context.js";

// Categories expand one way: "observability" is shown by Datadog, but "Datadog" is not shown by Grafana.
const CATEGORIES = {
  "ci/cd": ["ci cd", "continuous integration", "continuous delivery", "continuous deployment", "jenkins", "github actions", "gitlab ci", "circleci", "azure devops", "argo cd", "argocd"],
  observability: ["monitoring", "datadog", "prometheus", "grafana", "new relic", "splunk", "opentelemetry", "cloudwatch", "elk", "kibana", "dynatrace"],
  monitoring: ["observability", "datadog", "prometheus", "grafana", "new relic", "splunk", "cloudwatch", "dynatrace"],
  "automated testing": ["test automation", "automated tests", "unit testing", "unit tests", "integration tests", "jest", "junit", "pytest", "selenium", "cypress", "playwright", "mocha", "tdd"],
  "front end": ["frontend", "front-end", "react", "angular", "vue", "javascript", "typescript"],
  "back end": ["backend", "back-end", "api", "apis", "microservices", "server-side"],
  "large-scale": ["large scale", "high-scale", "at scale", "high-traffic", "high traffic", "millions of"],
  "distributed systems": ["distributed system", "microservices", "distributed"],
  "cloud-native": ["cloud native", "kubernetes", "docker", "containers", "serverless"],
  cloud: ["aws", "azure", "gcp", "google cloud"],
};
// Synonyms are interchangeable both ways.
const SYNONYMS = [
  ["javascript", "js"], ["node.js", "nodejs", "node"], ["kubernetes", "k8s"], ["postgresql", "postgres"],
  ["aws", "amazon web services"], ["gcp", "google cloud"], ["azure", "microsoft azure"], ["golang", "go"], ["c#", "csharp", ".net"],
  ["front end", "frontend", "front-end"], ["back end", "backend", "back-end"],
];
const FILLER = /\b(hands[- ]on|professional|production|strong|solid|proven|practical|demonstrated|technologies|technology|tools?|frameworks?|platforms?|practices|solutions|etc|e\.?g\.?|i\.?e\.?|including|such as|like|both|either|any|the|a|an)\b/gi;

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ").replace(/\s+/g, " ").trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (corpus, term) => new RegExp(`(^| )${escape(term)}( |$)`).test(corpus);

export function resumeEvidenceText(context) {
  const employment = context?.employment || context?.employmentHistory || [];
  return normalize([
    context?.skills, context?.values?.["candidate.summary"],
    ...employment.flatMap((row) => [row?.jobTitle, row?.experienceDetails]),
    ...(context?.certifications || []).map((item) => item?.name),
  ].filter(Boolean).join(" \n "));
}

function aliasesFor(term) {
  const same = SYNONYMS.find((group) => group.includes(term)) || [term];
  const category = same.flatMap((name) => CATEGORIES[name] || []);
  return [...new Set([term, ...same, ...category])];
}

function termFound(corpus, term) {
  if (aliasesFor(term).some((alias) => mentions(corpus, normalize(alias)))) return true;
  const words = term.split(" ").filter((word) => word.length >= 3);
  return words.length > 1 && words.every((word) => mentions(corpus, word));
}

// "with CI/CD, automated testing, observability, and monitoring" → ["ci/cd", "automated testing", ...].
export function questionTerms(question) {
  const text = String(question || "").split("?")[0];
  const match = text.match(/\b(?:experience|familiar(?:ity)?|proficien(?:t|cy)|knowledge|expertise|worked|work)\s+(?:\w+\s+){0,3}?(?:with|in|using|of|on)\s+(.+)$/i)
    || text.match(/\b(?:designing|building|delivering|developing|maintaining|operating)\s+(.+)$/i);
  if (!match) return { terms: [], any: false };
  let list = match[1].replace(/\([^)]*\)/g, " ");
  // "front end technologies such as Angular and React": the examples are what to look for, and any one counts.
  const example = list.match(/\b(?:such as|e\.?g\.?|including|like)\b(.+)$/i);
  const any = Boolean(example) || /\bor\b/i.test(list);
  if (example) list = example[1];
  const terms = list.split(/,|;|\s+and\s+|\s+or\s+|\s+&\s+|\s\/\s/i)
    .map((term) => normalize(term.replace(FILLER, " ")))
    .map((term) => term
      .replace(/^(?:(?:and|or|with|in|designing|building|delivering|developing|maintaining|operating|running)\s+)+/, "")
      .replace(/\s+(?:in|at|for|within)(?:\s+(?:production|scale|a team|teams))?$/, "")
      .trim())
    .filter((term) => term.length >= 2 && !/^(experience|years?|development|software|production)$/.test(term));
  return { terms: [...new Set(terms)].slice(0, 12), any };
}

function yearsAsked(question) {
  const match = String(question || "").match(/(\d{1,2})\s*\+?\s*(?:or more\s+|plus\s+)?years?/i);
  return match ? Number(match[1]) : null;
}

// Years in roles whose title or description mentions the skill, counting overlaps once.
function yearsWithSkill(context, terms, now) {
  const rows = (context?.employment || context?.employmentHistory || []).filter((row) => {
    const text = normalize(`${row?.jobTitle || ""} ${row?.experienceDetails || ""}`);
    return terms.some((term) => termFound(text, term));
  });
  return totalYearsOfExperience(rows, now);
}

// "Yes", "No", or "" when the rules cannot tell.
export function evidenceAnswer(context, question, now = new Date()) {
  const years = yearsAsked(question), { terms, any } = questionTerms(question), corpus = resumeEvidenceText(context);
  const skillTerms = terms.filter((term) => !/^(software|professional|relevant|industry|work)\b/.test(term) && !/\b(experience|engineering|development)$/.test(term));
  if (years !== null) {
    if (!skillTerms.length) return totalYearsOfExperience(context?.employment || context?.employmentHistory, now) >= years ? "Yes" : "No";
    if (!skillTerms.some((term) => termFound(corpus, term))) return "No";
    // On the Resume but the roles that describe it add up to fewer years: a person decides.
    return yearsWithSkill(context, skillTerms, now) >= years ? "Yes" : "";
  }
  if (!terms.length || !corpus) return "";
  const found = terms.filter((term) => termFound(corpus, term)).length;
  return (any ? found >= 1 : found >= Math.ceil(terms.length / 2)) ? "Yes" : "No";
}

