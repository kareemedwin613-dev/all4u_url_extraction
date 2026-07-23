import { safeError } from "../shared/errors.js";
export async function listIndustryDomains(client){const {data,error}=await client.from("industry_domain_categories").select("id,slug,name,description,sort_order").eq("active",true).order("sort_order").order("name");if(error)throw safeError(error,"INDUSTRY_DOMAINS_LOAD_FAILED","Industry domains could not be loaded.");return data||[];}
