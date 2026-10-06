import { isUnitedStates, usStateCode } from "./option-matching.js";

const screeningKey = (answerKey) => `screening.${answerKey}`;

const component=(date,name)=>date&&typeof date==="object"?date[name]??"":String(date||"").match(name==="year"?/\b(?:19|20)\d{2}\b/:/\b(?:0?[1-9]|1[0-2])\b/)?.[0]||"";
// Dates travel as "YYYY-MM" (or "YYYY"); the page adapter formats them for each control.
const dateText=(date)=>{
  if(!date||typeof date!=="object")return String(date||"");
  const year=Number(date.year),month=Number(date.month);
  if(!Number.isInteger(year))return"";
  return Number.isInteger(month)&&month>=1&&month<=12?`${year}-${String(month).padStart(2,"0")}`:String(year);
};
export function structuredAutofillValues(context){
  const values={};
  for(const [section,rows] of [["employment",context?.employment??context?.employmentHistory],["education",context?.education]]){
    (Array.isArray(rows)?rows:[]).slice(0,10).forEach((row,index)=>{
      const prefix=`${section}.${index}`;
      const mapping=section==="employment"?{
        company:row.company,jobTitle:row.jobTitle,location:row.location,startDate:dateText(row.startDate),startMonth:component(row.startDate,"month"),startYear:component(row.startDate,"year"),endDate:dateText(row.endDate),endMonth:component(row.endDate,"month"),endYear:component(row.endDate,"year"),isCurrent:row.isCurrent,description:row.experienceDetails,
      }:{
        institution:row.institution,degree:row.degree,fieldOfStudy:row.fieldOfStudy,location:row.location,startDate:dateText(row.startDate),startMonth:component(row.startDate,"month"),startYear:component(row.startDate,"year"),endDate:dateText(row.endDate),endMonth:component(row.endDate,"month"),endYear:component(row.endDate,"year"),gpa:row.gpa,
      };
      for(const [key,value] of Object.entries(mapping))if(value!==null&&value!==undefined&&value!=="")values[`${prefix}.${key}`]=value;
    });
  }
  return values;
}

// "Miami, FL, USA" as the Application Guide asks for Personal Details locations.
export function formatCandidateLocation(values){
  const city=String(values?.["candidate.city"]||"").trim(),state=String(values?.["candidate.state"]||"").trim(),country=String(values?.["candidate.country"]||"").trim();
  const us=!country||isUnitedStates(country);
  const parts=[city,us?usStateCode(state)||state:state,country?(us?"USA":country):""].filter(Boolean);
  return parts.length?parts.join(", "):String(values?.["candidate.currentLocation"]||"");
}

export function autofillValues(context){
  const values={...(context?.values||{}),...structuredAutofillValues(context)};
  if(values["candidate.city"]||values["candidate.currentLocation"])values["candidate.currentLocation"]=formatCandidateLocation(values);
  return values;
}

// Total years from the job history, counting overlapping roles once.
export function totalYearsOfExperience(employment=[],now=new Date()){
  const current=now.getUTCFullYear()*12+now.getUTCMonth();
  const months=(date)=>date&&Number.isInteger(Number(date.year))?Number(date.year)*12+(Number(date.month)>=1?Number(date.month)-1:0):null;
  const ranges=(Array.isArray(employment)?employment:[]).map(row=>{const start=months(row?.startDate);if(start===null)return null;const end=row?.isCurrent||!row?.endDate?current:months(row.endDate);return end===null||end<start?null:[start,Math.min(end,current)];}).filter(Boolean).sort((a,b)=>a[0]-b[0]);
  let total=0,open=null;
  for(const [start,end] of ranges){if(!open||start>open[1]){if(open)total+=open[1]-open[0];open=[start,end];}else open[1]=Math.max(open[1],end);}
  if(open)total+=open[1]-open[0];
  return Math.floor(total/12);
}

const SALARY_PERIODS=[[/hour/i,"per hour"],[/day/i,"per day"],[/week/i,"per week"],[/month/i,"per month"]];
export function salaryExpectation(job,fallback,inputType=""){
  const midpoint=salaryMidpoint(job),amount=Number(midpoint||String(fallback||"").replace(/[^\d.]/g,""));
  if(!Number.isFinite(amount)||amount<=0)return"";
  if(inputType==="number")return String(amount);
  const currency=String((midpoint&&job?.salaryCurrency)||"USD").toUpperCase(),period=(midpoint&&SALARY_PERIODS.find(([pattern])=>pattern.test(String(job?.salaryPeriod||"")))?.[1])||"per year";
  const formatted=amount.toLocaleString("en-US",{maximumFractionDigits:2});
  return`${currency==="USD"?`$${formatted}`:`${currency} ${formatted}`} ${period}`;
}

const GENDER_LABELS={MALE:"Male",FEMALE:"Female",NON_BINARY:"Non-binary"},PRONOUNS={MALE:"He/Him",FEMALE:"She/Her",NON_BINARY:"They/Them"};
const isoDay=(date)=>date.toISOString().slice(0,10);

export function guideDefinitions(context){
  return(Array.isArray(context?.guideEntries)?context.guideEntries:[]).map(entry=>({id:entry.id,question:entry.question,patterns:entry.patterns||[],mode:entry.mode,source:entry.source||null,sensitive:Boolean(entry.sensitive)}));
}

// The value for a guide-answered field, shaped for the control that will receive it.
export function guideValue(context,field,now=new Date()){
  const entry=(context?.guideEntries||[]).find(item=>`guide.${item.id}`===field?.key);
  if(!entry||entry.mode==="NEVER")return"";
  const type=String(field?.inputType||"");
  const numeric=(value)=>type==="number"?String(value).replace(/[^\d.]/g,""):String(value);
  if(entry.mode==="FIXED")return numeric(entry.value||"");
  switch(entry.source){
    case"gender":return GENDER_LABELS[context?.gender]||"";
    case"pronouns":return PRONOUNS[context?.gender]||"";
    case"salaryExpectation":return salaryExpectation(context?.job,entry.value,type==="number"||field?.controlType==="select"?"number":"");
    case"startAvailability":{const start=new Date(now.getTime()+14*24*60*60*1000);return type==="date"?isoDay(start):type==="month"?isoDay(start).slice(0,7):entry.value||"Two weeks after accepting an offer";}
    case"gpa":{const gpa=String(entry.value||"3.8");return type==="number"||field?.controlType==="select"?gpa:`${gpa} / 4.0`;}
    case"totalYearsOfExperience":{const years=totalYearsOfExperience(context?.employment||context?.employmentHistory,now);return(context?.employment||context?.employmentHistory||[]).length?String(years):"";}
    default:return String(autofillValues(context)[entry.source]??entry.value??"");
  }
}

export function salaryMidpoint(job) {
  const minimum=Number(job?.salaryMin),maximum=Number(job?.salaryMax);
  if(!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum<0||maximum<minimum||job?.salaryMin==null||job?.salaryMax==null)return"";
  return String(Math.round(((minimum+maximum)/2)*100)/100);
}

export function screeningDefinitions(context) {
  const definitions=(Array.isArray(context?.applicationAnswers) ? context.applicationAnswers : []).map((answer) => ({
    answerKey: answer.answerKey,
    answerType: answer.answerType,
    questionPatterns: Array.isArray(answer.questionPatterns) ? answer.questionPatterns : [],
  }));
  if(salaryMidpoint(context?.job)&&!definitions.some(answer=>answer.answerKey==="desired_salary"))definitions.push({answerKey:"desired_salary",answerType:"TEXT",questionPatterns:["What is your desired salary?","What are your salary expectations?"]});
  return definitions;
}

export function autofillValue(context, field) {
  if (String(field?.key||"").startsWith("guide.")) return guideValue(context, field);
  if (/^(candidate|employment|education)\./.test(String(field?.key||""))) return autofillValues(context)[field.key]??"";
  if(field?.answerKey==="desired_salary"){
    const midpoint=salaryMidpoint(context?.job);
    if(midpoint)return midpoint;
  }
  const answer = (context?.applicationAnswers || []).find((item) => screeningKey(item.answerKey) === field?.key);
  return answer?.answerValue ?? "";
}

export function autofillValueSource(context,field){
  if(String(field?.key||"").startsWith("guide."))return"Application Guide";
  if(field?.answerKey==="desired_salary"&&salaryMidpoint(context?.job))return"JD salary midpoint";
  return String(field?.key||"").startsWith("screening.")?"Verified Answer Library":String(field?.key||"").startsWith("candidate.")?"Verified Resume metadata":"Structured Resume";
}

function snapshot(answer) {
  if (!answer) return "";
  return JSON.stringify({
    answerKey: answer.answerKey, answerType: answer.answerType, answerValue: answer.answerValue,
    questionPatterns: answer.questionPatterns || [], reviewedAt: answer.reviewedAt,
  });
}

export function selectedScreeningAnswersUnchanged(previous, current, fields) {
  const keys = new Set((fields || []).filter((field) => String(field?.key || "").startsWith("screening.")).map((field) => field.answerKey));
  if (!keys.size) return true;
  for (const key of keys) {
    const before = (previous?.applicationAnswers || []).find((answer) => answer.answerKey === key);
    const after = (current?.applicationAnswers || []).find((answer) => answer.answerKey === key);
    if(key==="desired_salary"&&(salaryMidpoint(previous?.job)||salaryMidpoint(current?.job))){if(salaryMidpoint(previous?.job)!==salaryMidpoint(current?.job))return false;continue;}
    if (!before || !after || snapshot(before) !== snapshot(after)) return false;
  }
  return true;
}

export function displayAutofillValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value).replaceAll("_", " ");
}
