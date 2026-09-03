import { AppError } from "../shared/errors.js";
import { loadCachedLookup } from "./lookup-cache.js";
export async function listCategories(client,_baseUrl){
  return loadCachedLookup(client,"categories",async()=>{const{data,error}=await client.from("categories").select("id,slug,name,parent_id,sort_order,active").eq("active",true).order("sort_order");if(error)throw new AppError(String(error.code||"CATEGORIES_LOAD_FAILED"),"Categories could not be loaded.",String(error.message||error.details||""));return data||[];});
}
