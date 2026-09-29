import { SKILLS } from "./skills.js";
const escape = (value)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const matches=text=>SKILLS.map(({canonical,aliases})=>({canonical,index:Math.min(...aliases.map(alias=>String(text).search(new RegExp(`(^|[^a-z0-9+#.])${escape(alias)}(?=$|[^a-z0-9+#])`,"i"))).filter(index=>index>=0))})).filter(item=>Number.isFinite(item.index));
const ATOMIC_TECHNOLOGIES=new Set(SKILLS.flatMap(({canonical,aliases})=>[canonical,...aliases]).filter(value=>!/[\s,;|]/.test(value)).map(value=>value.toLowerCase()));
const CATEGORY_LABEL=/^(?:(?:(?:technical|core|professional|key|additional)\s+)?skills?|(?:(?:programming|scripting|markup|query)\s+)?languages?|frameworks?(?:\s*(?:&|and)\s*libraries)?|libraries|databases?(?:\s*(?:&|and)\s*data stores?)?|cloud(?:\s+(?:platforms?|services?|technologies))?|devops|ci\s*\/\s*cd(?:\s*(?:&|and)\s*devops)?|tools?(?:\s*(?:&|and)\s*technologies)?|technologies|platforms?|methodologies|testing(?:\s+tools?)?|front[ -]?end|back[ -]?end|data(?:\s+(?:engineering|technologies|tools))?|operating systems?|other)$/i;
// Kept in parity with resume_skill_tags_v132. Compound headings are labels,
// while individual capabilities (e.g. "Machine Learning") remain skills.
const SKILL_SECTION_GROUP=/^(?:machine learning\s*(?:&|and)\s*predictive analytics|data science\s*(?:&|and)\s*analytics|ml engineering|research\s*(?:&|and)\s*communication|optimization\s*(?:&|and)\s*decision science|financial\s*(?:&|and)\s*market analytics|languages\s*(?:&|and)\s*runtimes|ai\s*\/\s*ml|cloud\s*(?:&|and)\s*devops|data\s*(?:&|and)\s*databases|apis\s*(?:&|and)\s*web|architecture\s*(?:&|and)\s*security|testing\s*(?:&|and)\s*quality|tools\s*(?:&|and)\s*delivery|domain knowledge)$/i;
const SECTION_START=/^(?:(?:technical|core|professional|key|additional)\s+)?skills?(?=\s|:|$)\s*:?(.*)$/i;
const SECTION_END=/^(?:(?:professional|work|relevant)\s+)?experience\s*:?$|^(?:education|certifications?|projects?|publications?|summary|references)\s*:?$/i;
// null means no recoverable section; "" means an explicitly empty section.
export function originalSkillsSection(resume={}){
  if(typeof resume.structured_content?.skills==="string")return resume.structured_content.skills;
  const lines=String(resume.resume_text||"").replace(/\r\n?/g,"\n").split("\n"),result=[];
  let found=false;
  for(const raw of lines){const line=raw.trim();if(!found){const match=SECTION_START.exec(line);if(match){found=true;if(match[1].trim())result.push(match[1].trim());}}else{if(SECTION_END.test(line))break;result.push(line);}}
  return found?result.join("\n").trim():null;
}
export function originalResumeSkills(resume={}){
  const section=originalSkillsSection(resume);
  return section===null?preserveSkills(Array.isArray(resume.skills)?resume.skills:[]):skillsFromResumeSection(section);
}
export function detectSkills(text="") {
  return matches(text).map(({canonical})=>canonical).sort((a,b)=>a.localeCompare(b));
}
export function canonicalizeSkills(values=[]) {
  const lookup=new Map(SKILLS.flatMap((skill)=>[skill.canonical,...skill.aliases].map((name)=>[name.toLowerCase(),skill.canonical])));
  return [...new Set(values.map((v)=>lookup.get(String(v).trim().toLowerCase())).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
export function preserveSkills(values=[]){
  const result=[],seen=new Set();
  for(const value of values){const item=String(value||"").normalize("NFKC").replace(/\s+/g," ").trim();if(!item)continue;const key=item.toLocaleLowerCase();if(!seen.has(key)){seen.add(key);result.push(item);}}
  return result;
}
export function skillsFromResumeSection(section="",fallbackText=""){
  const source=String(section||"").normalize("NFKC").replace(/\r\n?/g,"\n").trim();
  if(!source)return detectSkills(fallbackText);
  const values=[];
  for(const rawLine of source.split("\n")){
    let line=rawLine.replace(/^\s*[•·▪◦*-]+\s*/,"").trim();if(!line)continue;
    if(CATEGORY_LABEL.test(line)||SKILL_SECTION_GROUP.test(line))continue;
    const prefix=line.match(/^([^:\u2013\u2014]{1,80})\s*[:\u2013\u2014]\s*(.*)$/);if(prefix)line=prefix[2].trim();
    // Whitespace is a delimiter only for an unambiguous list of known single-token
    // technologies. Preserve phrases like "Python and SQL Optimization" intact.
    for(const item of line.split(/\s+\/\s+|[,;|•·▪◦]+/).map(item=>item.trim()).filter(Boolean)){
      const tokens=item.split(/\s+/);values.push(...(tokens.length>1&&tokens.every(token=>ATOMIC_TECHNOLOGIES.has(token.toLowerCase()))?tokens:[item]));
    }
  }
  return preserveSkills(values);
}
