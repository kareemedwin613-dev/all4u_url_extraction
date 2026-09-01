import {APPLICATION_PRIORITIES,APPLICATION_STATUSES,DUE_FILTERS} from "./constants.js";
const allowed=(value,items)=>items.includes(value)?value:"";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,uuid=value=>UUID.test(String(value||""))?String(value):"";
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
  return count;
}
export function serializeApplicationQuery(value){
  const p=new URLSearchParams();
  for(const key of ["search","assignedTo","status","priority","company","profileName","resumeName","categoryId","dueFilter","creationBatchId","creationMode","page","pageSize"]){
    const v=value[key];
    if(v===""||v==null)continue;
    if(key==="pageSize"&&Number(v)===25)continue;
    if(key==="page"&&Number(v)===1)continue;
    p.set(key,String(v));
  }
  return p.toString();
}
