export const SENIORITY_VALUES = Object.freeze(["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL","MANAGER","DIRECTOR","EXECUTIVE","UNSPECIFIED"]);
const RULES = [["EXECUTIVE",/\b(chief|c-suite|executive|head of company)\b/i],["DIRECTOR",/\b(director|head of)\b/i],["MANAGER",/\bmanager\b/i],["PRINCIPAL",/\b(principal|staff)\b/i],["LEAD",/\b(tech(?:nical)? lead|team lead|lead)\b/i],["SENIOR",/\b(senior|sr\.?)\b/i],["MID",/\b(mid(?:-level)?)\b/i],["JUNIOR",/\b(junior|jr\.?)\b/i],["ENTRY",/\b(entry(?:-level)?|associate)\b/i],["INTERN",/\b(intern|internship)\b/i]];
export function normalizeSeniority(title = "") { return RULES.find(([, pattern]) => pattern.test(title))?.[0] || "UNSPECIFIED"; }
const IC = ["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL"];
export function seniorityCompatibility(job, resume) {
  if (job === "UNSPECIFIED" || resume === "UNSPECIFIED") return { compatibility:"unspecified", points:5 };
  if (job === resume) return { compatibility:"exact", points:15 };
  const a=IC.indexOf(job), b=IC.indexOf(resume);
  if (a>=0 && b>=0 && Math.abs(a-b)===1) return { compatibility:"adjacent", points:10 };
  if ((job==="LEAD"&&resume==="MANAGER")||(job==="MANAGER"&&resume==="LEAD")) return { compatibility:"configured-adjacent", points:10 };
  return { compatibility:"incompatible", points:0 };
}
