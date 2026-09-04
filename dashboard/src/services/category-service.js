import {authenticatedApiRequest} from "./api-client.js";
export async function loadCategories(client,apiBaseUrl){const {payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/lookups/categories"});const rows=payload.data||[],byId=new Map(rows.map(x=>[x.id,x])),bySlug=new Map(rows.map(x=>[x.slug,x])),primary=rows.filter(x=>!x.parent_id),childrenByParent=new Map();for(const row of rows.filter(x=>x.parent_id)){const list=childrenByParent.get(row.parent_id)||[];list.push(row);childrenByParent.set(row.parent_id,list);}return {byId,bySlug,primary,childrenByParent};}
export const categoryName=(cache,id)=>cache?.byId.get(id)?.name||"Unknown category";
export function resumeTechStackRows(resume={}){
  if(Array.isArray(resume.tech_stacks)&&resume.tech_stacks.length)return resume.tech_stacks;
  return resume.primary_category_id?[{primary_category_id:resume.primary_category_id,subcategory_id:resume.subcategory_id||null}]:[];
}
export function formatResumeTechStacks(cache,resume,kind="primary"){
  const ids=[...new Set(resumeTechStackRows(resume).map((row)=>kind==="sub"?row.subcategory_id:row.primary_category_id).filter(Boolean))];
  if(!ids.length)return kind==="sub"?"None":"Unknown category";
  return ids.map((id)=>categoryName(cache,id)).join(", ");
}
export function applicationTechStackLabels(record={}){
  const names=Array.isArray(record.resume_category_names)?record.resume_category_names.filter(Boolean):[];
  if(names.length)return names;
  if(record.category_name)return [record.category_name];
  return [];
}
export function applicationTechStackIds(record={}){
  const ids=Array.isArray(record.resume_category_ids)?record.resume_category_ids.filter(Boolean):[];
  if(ids.length)return ids;
  return record.category_id?[record.category_id]:[];
}
