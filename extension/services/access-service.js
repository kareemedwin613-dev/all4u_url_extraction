import {AppError} from "../shared/errors.js";
import {normalizeExtensionAccess} from "../access/capabilities.js";

export async function getMyAccessContext(client,_baseUrl) {
  const {data,error}=await client.auth.getSession();
  if(error||!data.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");
  const result=await client.rpc("get_my_access_context");
  if(result.error)throw new AppError(String(result.error.code||"ACCESS_CONTEXT_FAILED"),"Your access context could not be loaded.",String(result.error.message||result.error.details||""));
  try{return normalizeExtensionAccess(result.data);}catch(error){throw new AppError(error.code||"ACCESS_CONTEXT_FAILED",error.message||"Your access context could not be loaded.");}
}
