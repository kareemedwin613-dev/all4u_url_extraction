import { AppError } from "../shared/errors.js";
let cached,expiresAt=0,inFlight;
export async function listIndustryDomains(client,_baseUrl){
  if(cached&&expiresAt>Date.now())return cached;
  if(inFlight)return inFlight;
  inFlight=(async()=>{const{data,error}=await client.from("industry_domain_categories").select("id,slug,name,description,sort_order").eq("active",true).order("sort_order").order("name");if(error)throw new AppError(String(error.code||"INDUSTRY_DOMAINS_LOAD_FAILED"),"Industry domains could not be loaded.",String(error.message||error.details||""));cached=data||[];expiresAt=Date.now()+5*60_000;return cached;})().finally(()=>{inFlight=null;});
  return inFlight;
}
