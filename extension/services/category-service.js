import { AppError } from "../shared/errors.js";
let cached,expiresAt=0,inFlight;
export async function listCategories(client,_baseUrl){
  if(cached&&expiresAt>Date.now())return cached;
  if(inFlight)return inFlight;
  inFlight=(async()=>{const{data,error}=await client.from("categories").select("id,slug,name,parent_id,sort_order,active").eq("active",true).order("sort_order");if(error)throw new AppError(String(error.code||"CATEGORIES_LOAD_FAILED"),"Categories could not be loaded.",String(error.message||error.details||""));cached=data||[];expiresAt=Date.now()+5*60_000;return cached;})().finally(()=>{inFlight=null;});
  return inFlight;
}
