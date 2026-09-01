export const TAILORED_SKILL_GROUP_NAMES=[
  "Languages & Runtimes",
  "AI / ML",
  "Frameworks & Libraries",
  "Cloud & DevOps",
  "Data & Databases",
  "APIs & Web",
  "Architecture & Security",
  "Testing & Quality",
  "Tools & Delivery",
  "Domain Knowledge",
  "Additional Skills",
] as const;

export type TailoredSkillGroupName=(typeof TAILORED_SKILL_GROUP_NAMES)[number];
export interface TailoredSkillGroup{name:TailoredSkillGroupName;skills:string[];}
export const MAX_TAILORED_SKILLS=80;
const names=new Set<string>(TAILORED_SKILL_GROUP_NAMES);
const clean=(value:unknown)=>String(value??"").trim().replace(/\s+/g," ");
const key=(value:unknown)=>clean(value).toLocaleLowerCase();
const values=(value:unknown):any[]=>Array.isArray(value)?value:[];

export function inferTailoredSkillGroup(skill:string):TailoredSkillGroupName{
  const value=key(skill);
  if(/(^|\b)(agentic ai|ai|artificial intelligence|machine learning|deep learning|llm|large language model|rag|retrieval[- ]augmented|knowledge retrieval|human-in-the-loop|prompt engineering|nlp|natural language processing|computer vision|tensorflow|pytorch|scikit|hugging face|langchain|llamaindex|generative ai|model training)(\b|$)/.test(value))return"AI / ML";
  if(/^(c|c\+\+|c#|java|javascript|typescript|python|php|ruby|go|golang|rust|kotlin|swift|scala|r|matlab|dart|perl|bash|shell|powershell|visual basic|vb\.net|node\.js|nodejs)$/.test(value))return"Languages & Runtimes";
  if(/(^|\b)(\.net|asp\.net|mvc|react|angular|vue|next\.js|nuxt|spring|django|flask|fastapi|express|jquery|bootstrap|tailwind|laravel|rails|hibernate|entity framework|redux|rxjs|library|framework|reusable component)(\b|$)/.test(value))return"Frameworks & Libraries";
  if(/(^|\b)(aws|amazon web services|azure|gcp|google cloud|docker|kubernetes|terraform|ansible|jenkins|github actions|gitlab ci|circleci|ci\/cd|continuous integration|continuous delivery|devops|git|github|gitlab|bitbucket|subversion|svn|linux|unix|windows server|container|infrastructure as code|iac)(\b|$)/.test(value))return"Cloud & DevOps";
  if(/(^|\b)(sql|sql server|mysql|oracle|postgres|postgresql|mongodb|redis|snowflake|redshift|databricks|spark|hadoop|kafka|ssis|ssrs|etl|elt|database|data warehouse|data lake|data integration|data engineering|data[- ]access|reporting|stored procedure|indexing|tableau|power bi|data analytics|data science)(\b|$)/.test(value))return"Data & Databases";
  if(/(^|\b)(api|apis|rest|restful|graphql|grpc|soap|http|html|css|xml|json|web|frontend|front-end|backend|back-end|full-stack|full stack|integration|micro frontend|web graphics|document formatting)(\b|$)/.test(value))return"APIs & Web";
  if(/(^|\b)(architecture|application modernization|microservice|service-oriented|service layer|soa|design pattern|security|authentication|authorization|rbac|role-based access control|oauth|jwt|iam|encryption|audit logging|observability|monitoring|logging|secure data|phi|pii|privacy|compliance|secrets management|zero trust)(\b|$)/.test(value))return"Architecture & Security";
  if(/(^|\b)(test|testing|quality|qa|regression|unit test|integration test|automation test|code review|data validation|debugging|troubleshooting|performance optimization|load test|acceptance test)(\b|$)/.test(value))return"Testing & Quality";
  if(/(^|\b)(agile|scrum|kanban|jira|confluence|excel|sdlc|requirements|stakeholder|sprint|documentation|workflow automation|release coordination|project management|support workflow|source control|issue tracking|scheduled job|wiki|crm|erp|provisioning|collaboration)(\b|$)/.test(value))return"Tools & Delivery";
  if(/(^|\b)(healthcare|finance|financial|banking|insurance|retail|e-commerce|government|education|manufacturing|telecommunications|marketing|sales|accounting|human resources|supply chain|logistics)(\b|$)/.test(value))return"Domain Knowledge";
  return"Additional Skills";
}

export function resolveTailoredSkillGroups(skillsValue:unknown,groupsValue:unknown):TailoredSkillGroup[]{
  const skills:string[]=[];const unique=new Set<string>();
  for(const raw of values(skillsValue)){const skill=clean(raw),skillKey=key(skill);if(!skill||unique.has(skillKey))continue;unique.add(skillKey);skills.push(skill);if(skills.length===MAX_TAILORED_SKILLS)break;}
  const canonical=new Map(skills.map(skill=>[key(skill),skill])),assigned=new Set<string>(),buckets=new Map<TailoredSkillGroupName,string[]>();
  const add=(name:TailoredSkillGroupName,skill:unknown)=>{const skillKey=key(skill),value=canonical.get(skillKey);if(!value||assigned.has(skillKey))return;assigned.add(skillKey);const bucket=buckets.get(name)||[];bucket.push(value);buckets.set(name,bucket);};
  for(const raw of values(groupsValue)){if(!raw||typeof raw!=="object")continue;const proposed=raw as Record<string,unknown>,name=names.has(clean(proposed.name))?clean(proposed.name) as TailoredSkillGroupName:"Additional Skills";for(const skill of values(proposed.skills))add(name,skill);}
  for(const skill of skills)if(!assigned.has(key(skill)))add(inferTailoredSkillGroup(skill),skill);
  return TAILORED_SKILL_GROUP_NAMES.flatMap(name=>{const grouped=buckets.get(name)||[];return grouped.length?[{name,skills:grouped}]:[];});
}
