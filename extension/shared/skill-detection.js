import { SKILLS } from "./skills.js";
const escape = (value)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const matches=text=>SKILLS.map(({canonical,aliases})=>({canonical,index:Math.min(...aliases.map(alias=>String(text).search(new RegExp(`(^|[^a-z0-9+#.])${escape(alias)}(?=$|[^a-z0-9+#])`,"i"))).filter(index=>index>=0))})).filter(item=>Number.isFinite(item.index));
const CATEGORY_LABEL=/^(?:(?:(?:technical|core|professional|key|additional)\s+)?skills?|(?:(?:programming|scripting|markup|query)\s+)?languages?|frameworks?(?:\s*(?:&|and)\s*libraries)?|libraries|databases?(?:\s*(?:&|and)\s*data stores?)?|cloud(?:\s+(?:platforms?|services?|technologies))?|devops|ci\s*\/\s*cd(?:\s*(?:&|and)\s*devops)?|tools?(?:\s*(?:&|and)\s*technologies)?|technologies|platforms?|methodologies|testing(?:\s+tools?)?|front[ -]?end|back[ -]?end|data(?:\s+(?:engineering|technologies|tools))?|operating systems?|other)$/i;
function splitWhitespaceSkills(value){
  const source=String(value),found=[];
  for(const {aliases} of SKILLS)for(const alias of aliases){const match=new RegExp(`(^|[^a-z0-9+#.])(${escape(alias)})(?=$|[^a-z0-9+#])`,"i").exec(source);if(match)found.push({index:match.index+match[1].length,end:match.index+match[1].length+match[2].length});}
  found.sort((a,b)=>a.index-b.index||(b.end-b.index)-(a.end-a.index));
  const selected=[];for(const item of found)if(!selected.some(other=>item.index<other.end&&item.end>other.index))selected.push(item);
  if(selected.length<2)return[source];
  const result=[];let cursor=0;for(const item of selected){const before=source.slice(cursor,item.index).replace(/^[\s/]+|[\s/]+$/g,"");if(before)result.push(before);result.push(source.slice(item.index,item.end));cursor=item.end;}const after=source.slice(cursor).replace(/^[\s/]+|[\s/]+$/g,"");if(after)result.push(after);return result;
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
    if(CATEGORY_LABEL.test(line))continue;
    const prefix=line.match(/^([^:\u2013\u2014]{1,80})\s*[:\u2013\u2014]\s*(.+)$/);if(prefix&&CATEGORY_LABEL.test(prefix[1].trim()))line=prefix[2].trim();
    for(const item of line.split(/\s+\/\s+|[,;|•·▪◦]+/).map(item=>item.trim()).filter(Boolean))values.push(...splitWhitespaceSkills(item));
  }
  return preserveSkills(values);
}
