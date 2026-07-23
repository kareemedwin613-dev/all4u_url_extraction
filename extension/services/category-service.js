import { safeError } from "../shared/errors.js";
export async function listCategories(client){const {data,error}=await client.from("categories").select("id,slug,name,parent_id,sort_order").eq("active",true).order("sort_order");if(error)throw safeError(error,"CATEGORY_LOAD_FAILED","Categories could not be loaded.");return data||[];}
