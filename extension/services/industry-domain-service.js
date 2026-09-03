import { AppError } from "../shared/errors.js";
import { loadCachedLookup } from "./lookup-cache.js";
export async function listIndustryDomains(client,_baseUrl){
  return loadCachedLookup(client,"industry-domains",async()=>{const{data,error}=await client.from("industry_domain_categories").select("id,slug,name,description,sort_order").eq("active",true).order("sort_order").order("name");if(error)throw new AppError(String(error.code||"INDUSTRY_DOMAINS_LOAD_FAILED"),"Industry domains could not be loaded.",String(error.message||error.details||""));return data||[];});
}
