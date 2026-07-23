import { SKILLS } from "./skills.js";
const escape = (value)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
export function detectSkills(text="") {
  const source=String(text);
  return SKILLS.filter(({aliases})=>aliases.some((alias)=>new RegExp(`(^|[^a-z0-9+#.])${escape(alias)}(?=$|[^a-z0-9+#])`,"i").test(source))).map(({canonical})=>canonical).sort((a,b)=>a.localeCompare(b));
}
export function canonicalizeSkills(values=[]) {
  const lookup=new Map(SKILLS.flatMap((skill)=>[skill.canonical,...skill.aliases].map((name)=>[name.toLowerCase(),skill.canonical])));
  return [...new Set(values.map((v)=>lookup.get(String(v).trim().toLowerCase())).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
