import { overviewDateBounds } from "../overview/overview-date.js";
import {APPLICATION_PRIORITIES,APPLICATION_STATUSES,DUE_FILTERS} from "./constants.js";
const allowed=(value,items)=>items.includes(value)?value:"";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,uuid=value=>UUID.test(String(value||""))?String(value):"";
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const calendarDate=value=>DATE.test(String(value||""))?String(value):"";
export const SCREENSHOT_FEEDBACK_FILTERS=Object.freeze(["HAS_FEEDBACK","NO_FEEDBACK"]);
export const APPLIED_WINDOWS=Object.freeze(["TODAY","THIS_WEEK","THIS_MONTH","CUSTOM"]);
export function parseApplicationQuery(query=""){
  const p=new URLSearchParams(query),
    pageSize=[25,50,100,500,1000,5000].includes(Number(p.get("pageSize")))?Number(p.get("pageSize")):25,
    page=Math.max(1,Number(p.get("page"))||1);
  return {
    search:(p.get("search")||"").trim().slice(0,100),
    assignedTo:uuid(p.get("assignedTo")),
    status:allowed(p.get("status")||"",APPLICATION_STATUSES),
    priority:allowed(p.get("priority")||"",APPLICATION_PRIORITIES),
    company:(p.get("company")||"").trim().slice(0,100),
    profileName:(p.get("profileName")||"").trim().slice(0,100),
    resumeName:(p.get("resumeName")||"").trim().slice(0,100),
    categoryId:uuid(p.get("categoryId")),
    dueFilter:allowed(p.get("dueFilter")||"",DUE_FILTERS.map(x=>x[0])),
    creationBatchId:uuid(p.get("creationBatchId")),
    creationMode:allowed(p.get("creationMode")||"",["BULK","INDIVIDUAL"]),
    screenshotFeedback:allowed(p.get("screenshotFeedback")||"",SCREENSHOT_FEEDBACK_FILTERS),
    screenshotReviewFeedback:allowed(p.get("screenshotFeedback")||"",SCREENSHOT_FEEDBACK_FILTERS)==="HAS_FEEDBACK"?(p.get("screenshotReviewFeedback")||"").trim().slice(0,100):"",
    screenshotFilename:(p.get("screenshotFilename")||"").trim().slice(0,100),
    primaryReviewerId:uuid(p.get("primaryReviewerId")),
    secondaryReviewerId:uuid(p.get("secondaryReviewerId")),
    appliedWindow:allowed(p.get("appliedWindow")||"",APPLIED_WINDOWS),
    appliedFrom:calendarDate(p.get("appliedFrom")),
    appliedTo:calendarDate(p.get("appliedTo")),
    page,
    pageSize,
  };
}
export function countActiveApplicationFilters(filters={}){
  let count=0;
  if(filters.search)count++;
  if(filters.company)count++;
  if(filters.profileName)count++;
  if(filters.resumeName)count++;
  if(filters.status)count++;
  if(filters.categoryId)count++;
  if(filters.assignedTo)count++;
  if(filters.screenshotFeedback)count++;
  if(filters.screenshotFeedback==="HAS_FEEDBACK"&&filters.screenshotReviewFeedback)count++;
  if(filters.screenshotFilename)count++;
  if(filters.primaryReviewerId)count++;
  if(filters.secondaryReviewerId)count++;
  if(filters.appliedWindow==="TODAY"||filters.appliedWindow==="THIS_WEEK"||filters.appliedWindow==="THIS_MONTH"||(filters.appliedFrom&&filters.appliedTo))count++;
  return count;
}
export function serializeApplicationQuery(value){
  const p=new URLSearchParams();
  for(const key of ["search","assignedTo","status","priority","company","profileName","resumeName","categoryId","dueFilter","creationBatchId","creationMode","screenshotFeedback","screenshotReviewFeedback","screenshotFilename","primaryReviewerId","secondaryReviewerId","appliedWindow","appliedFrom","appliedTo","page","pageSize"]){
    const v=value[key];
    if(v===""||v==null)continue;
    if(key==="pageSize"&&Number(v)===25)continue;
    if(key==="page"&&Number(v)===1)continue;
    p.set(key,String(v));
  }
  return p.toString();
}

/** Inclusive local calendar range as a half-open instant window. Spans of 370 days or more are ignored. */
export function appliedDateQuery(from,to){
  if(!DATE.test(from)||!DATE.test(to)||from>to)return {};
  const span=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000;
  if(!Number.isFinite(span)||span<0||span>=370)return {};
  const [year,month,day]=from.split("-").map(Number);
  const [endYear,endMonth,endDay]=to.split("-").map(Number);
  const start=new Date(year,month-1,day);
  const end=new Date(endYear,endMonth-1,endDay);
  end.setDate(end.getDate()+1);
  return {appliedFrom:start.toISOString(),appliedTo:end.toISOString()};
}

export function appliedListBounds(filters={},now=new Date()){
  const window=filters.appliedWindow;
  if(window==="TODAY"||window==="THIS_WEEK"||window==="THIS_MONTH"){
    const bounds=overviewDateBounds({window,from:"",to:""},now);
    return bounds?{appliedFrom:bounds.from,appliedTo:bounds.to}:{};
  }
  return appliedDateQuery(filters.appliedFrom,filters.appliedTo);
}
