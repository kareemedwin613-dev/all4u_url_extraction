import {AppError,safeError} from "../shared/errors.js";
import {normalizeExtensionAccess} from "../access/capabilities.js";

export async function getMyAccessContext(client) {
  const {data,error}=await client.rpc("get_my_access_context");
  if(error)throw safeError(error,"ACCESS_CONTEXT_FAILED","Your access context could not be loaded.");
  try{return normalizeExtensionAccess(data);}catch(error){throw new AppError(error.code||"ACCESS_CONTEXT_FAILED",error.message||"Your access context could not be loaded.");}
}
