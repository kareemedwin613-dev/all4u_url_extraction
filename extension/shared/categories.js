export const JOB_CATEGORIES = Object.freeze([
  "Data Engineering", "AI / Machine Learning", "Software Engineering", "Backend Engineering",
  "Frontend Engineering", "Full Stack Engineering", "Data Analytics / BI", "Cloud / DevOps / SRE",
  "Cybersecurity", "Database Engineering", "Financial / Business Analysis", "Product / Program Management",
  "Quality Assurance", "Other", "Uncategorized"
]);

export const SENIORITY_LEVELS = Object.freeze([
  "Intern", "Entry", "Associate", "Mid-Level", "Senior", "Lead", "Staff", "Principal",
  "Manager", "Director", "Vice President", "Executive", "Unspecified"
]);

const KEYWORDS = {
  "Data Engineering": ["data engineer", "data pipeline", "etl", "elt", "snowflake", "databricks", "spark", "pyspark", "airflow", "dbt", "data warehouse", "data lake", "kafka", "azure data factory", "fivetran"],
  "AI / Machine Learning": ["ai engineer", "applied ai", "machine learning engineer", "ml engineer", "llm", "generative ai", "model training", "inference", "embeddings", "vector database", "rag", "pytorch", "tensorflow"],
  "Software Engineering": ["software engineer", "software developer", "application developer"],
  "Backend Engineering": ["backend engineer", "api development", "microservices", "spring boot", "golang", "distributed systems", "server-side"],
  "Frontend Engineering": ["frontend engineer", "front-end engineer", "ui engineer", "web ui"],
  "Full Stack Engineering": ["full stack", "full-stack", "frontend and backend", "react", "angular", "vue", "typescript", "node.js"],
  "Data Analytics / BI": ["data analyst", "business intelligence", "tableau", "power bi", "sigma", "dashboard", "reporting", "sql analyst"],
  "Cloud / DevOps / SRE": ["devops", "site reliability", "sre", "kubernetes", "terraform", "infrastructure as code", "ci/cd", "observability", "cloud engineer", "platform engineer"],
  Cybersecurity: ["cybersecurity", "security engineer", "information security", "soc analyst"],
  "Database Engineering": ["database engineer", "database administrator", "dba", "postgresql", "oracle database"],
  "Financial / Business Analysis": ["financial analyst", "business analyst", "forecasting", "budgeting", "variance analysis", "financial modeling", "requirements gathering"],
  "Product / Program Management": ["product manager", "program manager", "product owner", "roadmap"],
  "Quality Assurance": ["quality assurance", "qa engineer", "test engineer", "automation tester"]
};

const includesKeyword = (text, keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

export function suggestCategory(title = "", description = "") {
  const scores = Object.entries(KEYWORDS).map(([category, words]) => [category, words.reduce((score, word) => score + (includesKeyword(title, word) ? 5 : 0) + (includesKeyword(description, word) ? (word.includes(" ") ? 2 : 1) : 0), 0)]);
  scores.sort((a, b) => b[1] - a[1]);
  return !scores[0][1] || (scores[1] && scores[0][1] === scores[1][1]) ? "Uncategorized" : scores[0][0];
}

const SUBCATEGORY_KEYWORDS = [
  ["Risk / Compliance", ["risk", "compliance", "financial crime", "fraud", "aml", "anti-money laundering", "regulatory", "controls"]],
  ["Healthcare / Clinical", ["healthcare", "clinical", "patient", "pharmacy", "medical claims", "health plan", "hipaa"]],
  ["FinTech / Payments", ["fintech", "payments", "payment", "banking", "financial services", "cash app", "card processing", "merchant"]],
  ["E-commerce / Retail", ["e-commerce", "ecommerce", "retail", "marketplace", "shopping", "merchandising"]],
  ["Cybersecurity", ["cybersecurity", "information security", "threat detection", "incident response", "security operations", "soc"]],
  ["Marketing / Advertising", ["marketing", "advertising", "adtech", "campaign", "customer acquisition"]],
  ["Supply Chain / Logistics", ["supply chain", "logistics", "fulfillment", "warehouse operations", "transportation"]],
  ["Insurance", ["insurance", "underwriting", "claims processing", "actuarial"]],
  ["Azure / Databricks", ["azure data factory", "azure", "databricks", "pyspark"]],
  ["AWS", ["amazon web services", "aws", "redshift", "glue", "s3"]],
  ["Snowflake / dbt", ["snowflake", "dbt", "snowpipe"]],
  ["Data Platform", ["data platform", "data warehouse", "data lake", "lakehouse", "data infrastructure"]]
];

export function suggestSubcategory(title = "", description = "", category = "") {
  const scores = SUBCATEGORY_KEYWORDS.map(([name, words], priority) => ({
    name,
    priority,
    score: words.reduce((score, word) => score + (includesKeyword(title, word) ? 5 : 0) + (includesKeyword(description, word) ? 1 : 0), 0)
  })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.priority - b.priority);
  if (!scores.length) return "";
  const best = scores[0];
  const isTechnology = best.priority >= 8;
  const minimum = isTechnology && !/Engineering|Analytics|Machine Learning|Database/.test(category) ? 2 : 1;
  return best.score >= minimum ? best.name : "";
}

const CONTROLLED_CATEGORY_SLUGS = Object.freeze({
  "Data Engineering":"data-engineering","AI / Machine Learning":"ai-machine-learning","Software Engineering":"software-engineering","Backend Engineering":"software-engineering","Frontend Engineering":"software-engineering","Full Stack Engineering":"software-engineering","Data Analytics / BI":"business-intelligence-analytics","Cloud / DevOps / SRE":"cloud-devops-reliability","Cybersecurity":"cybersecurity","Financial / Business Analysis":"business-project-roles"
});
const CONTROLLED_SUBCATEGORY_SLUGS = Object.freeze({"Azure / Databricks":"databricks","Snowflake / dbt":"snowflake","AWS":"aws-data-engineering","Data Platform":"etl-data-warehousing","Cybersecurity":"security-engineering","Risk / Compliance":"governance-risk-compliance"});
export function suggestControlledCategory(title="",description="") {
  const category=suggestCategory(title,description),categorySlug=CONTROLLED_CATEGORY_SLUGS[category]||null;
  if(!categorySlug)return {categorySlug:null,subcategorySlug:null,confidence:"low",reasons:[]};
  const subcategory=suggestSubcategory(title,description,category),subcategorySlug=CONTROLLED_SUBCATEGORY_SLUGS[subcategory]||null;
  const titleMatched=suggestCategory(title,"")===category;
  return {categorySlug,subcategorySlug,confidence:titleMatched?"high":"medium",reasons:[titleMatched?`job title indicates ${category}`:`description indicates ${category}`,...(subcategorySlug?[`description indicates ${subcategory}`]:[])]};
}

const SENIORITY_PATTERNS = [
  ["Executive", /\b(chief|c-suite|executive)\b/i], ["Vice President", /\b(vice president|vp)\b/i],
  ["Director", /\bdirector\b/i], ["Manager", /\bmanager\b/i], ["Principal", /\bprincipal\b/i],
  ["Staff", /\bstaff\b/i], ["Lead", /\blead\b/i], ["Senior", /\b(senior|sr\.?)(?=\s|$)/i],
  ["Associate", /\bassociate\b/i], ["Entry", /\b(entry(?:-level)?|junior|jr\.?)\b/i], ["Intern", /\b(intern|internship)\b/i]
];
export function suggestSeniority(title = "") {
  return SENIORITY_PATTERNS.find(([, pattern]) => pattern.test(title))?.[0] ?? "Unspecified";
}
