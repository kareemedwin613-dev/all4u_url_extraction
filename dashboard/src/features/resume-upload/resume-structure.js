const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
const MONTH_NAME="(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const NUMERIC_MONTH_YEAR="(?:0?[1-9]|1[0-2])/(?:19|20)\\d{2}";
const DATE_TOKEN=`(?:${MONTH_NAME}\\s+)?(?:19|20)\\d{2}|${NUMERIC_MONTH_YEAR}`;
const DATE_RANGE=new RegExp(`(?:^|[^\\d/])(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|Present|Current|Now)\\b`,"i");
const BULLET=/^\s*(?:[•●▪◦‣∙]|[-*])\s*/;
let fallbackId=0;

const makeId=()=>globalThis.crypto?.randomUUID?.()||`local-${Date.now()}-${++fallbackId}`;
const text=value=>String(value||"").replace(/\0/g,"").replace(/\r\n?/g,"\n").trim();

export const newExperience=()=>({id:makeId(),company:"",job_title:"",location:"",start_date:null,end_date:null,is_current:false,experience_details:""});

export function parsePartialDate(value){
  const raw=text(value);
  const numeric=raw.match(/^(0?[1-9]|1[0-2])\/((?:19|20)\d{2})$/);
  if(numeric)return{year:Number(numeric[2]),month:Number(numeric[1])};
  const match=raw.match(/^(?:([A-Za-z]+)\s+)?((?:19|20)\d{2})$/);if(!match)return null;
  const month=match[1]?MONTHS[match[1].toLowerCase()]:null;
  if(match[1]&&!month)return null;
  return {year:Number(match[2]),month};
}

/** Resolve subcategory id only when both category rows exist and the parent matches. */
export function resolveSubcategoryId(primary,subcategory){
  return primary&&subcategory?.parent_id===primary.id?subcategory.id:"";
}

export function partialDateInput(value){return value?.year?`${value.year}-${String(value.month||1).padStart(2,"0")}`:"";}
export function partialDateFromInput(value){const match=String(value||"").match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/);return match?{year:Number(match[1]),month:Number(match[2])}:null;}
export function partialDateLabel(value){if(!value?.year)return "";if(!value.month)return String(value.year);return new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(value.year,value.month-1,1)));}

function experienceDetails(lines){
  const result=[];for(const raw of lines){const line=text(raw);if(!line)continue;if(BULLET.test(line))result.push(`• ${line.replace(BULLET,"")}`);else if(result.length)result[result.length-1]+=` ${line}`;else result.push(line);}return result.join("\n");
}

function splitTitleLocation(value,initialLocation=""){
  const line=text(value),match=line.match(/^(.*?)(?:\s{2,}|\s[-–—]\s)(Remote|Hybrid|On[- ]?site)$/i)||line.match(/^(.*?)\s+(Remote)$/i);
  return match?{jobTitle:text(match[1]),location:initialLocation||match[2]}:{jobTitle:line,location:initialLocation};
}

export function parseProfessionalExperiences(value=""){
  const lines=text(value).split("\n").map(line=>line.trim()).filter(Boolean),markers=[];
  lines.forEach((line,index)=>{
    const match=line.match(DATE_RANGE);if(!match)return;
    // DATE_RANGE may consume a non-digit/slash prefix char before the first date token.
    const rangeStart=match.index+(match[0].startsWith(match[1])?0:1);
    markers.push({index,match,before:text(line.slice(0,rangeStart)),after:text(line.slice(match.index+match[0].length))});
  });
  if(!markers.length){const details=experienceDetails(lines);return details?[{...newExperience(),experience_details:details}]:[];}
  return markers.map((marker,position)=>{
    const next=markers[position+1],company=marker.before||text(lines[marker.index-1]),start=marker.index+1,end=next?next.index-(next.before?0:1):lines.length,segment=lines.slice(start,Math.max(start,end));
    let titleIndex=segment.findIndex(line=>!BULLET.test(line)),title="";if(titleIndex>=0){title=segment[titleIndex];segment.splice(titleIndex,1);}
    let extractedLocation=marker.after;if(!extractedLocation&&/^(remote|hybrid|on[- ]?site)$/i.test(segment[0]||""))extractedLocation=segment.shift();
    const titleLocation=splitTitleLocation(title,extractedLocation),current=/^(present|current|now)$/i.test(marker.match[2]);
    return {...newExperience(),company,job_title:titleLocation.jobTitle,location:titleLocation.location,start_date:parsePartialDate(marker.match[1]),end_date:current?null:parsePartialDate(marker.match[2]),is_current:current,experience_details:experienceDetails(segment)};
  });
}

function normalizeExperience(value){
  const legacyBullets=Array.isArray(value?.bullets)?value.bullets.map(item=>`• ${text(item?.text)}`).filter(item=>item!=="• ").join("\n"):"";
  return {id:text(value?.id)||makeId(),company:text(value?.company),job_title:text(value?.job_title),location:text(value?.location),start_date:value?.start_date||null,end_date:value?.is_current?null:(value?.end_date||null),is_current:Boolean(value?.is_current),experience_details:text(value?.experience_details)||legacyBullets};
}

export function normalizeStructuredResumeV2(value={}){
  const rawExperience=value?.professional_experience,professionalExperience=Array.isArray(rawExperience)?rawExperience.map(normalizeExperience):parseProfessionalExperiences(rawExperience);
  const education=Array.isArray(value?.education)?value.education.map(item=>({id:text(item?.id)||makeId(),institution:text(item?.institution),degree:text(item?.degree),field_of_study:text(item?.field_of_study),location:text(item?.location),start_date:item?.start_date||null,end_date:item?.end_date||null,gpa:text(item?.gpa),details:text(item?.details)})):text(value?.education);
  const certifications=Array.isArray(value?.certifications)?value.certifications:[];
  return {summary:text(value?.summary),professional_experience:professionalExperience,education,education_legacy_text:text(value?.education_legacy_text),certifications,skills:text(value?.skills)};
}

export function cleanStructuredResumeV2(value={}){
  return normalizeStructuredResumeV2(value);
}

export function experienceDateRange(experience){const start=partialDateLabel(experience?.start_date),end=experience?.is_current?"Present":partialDateLabel(experience?.end_date);return start&&end?`${start} – ${end}`:start||end||"Dates not specified";}
