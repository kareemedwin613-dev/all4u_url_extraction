import {AppError} from "../shared/errors.js";
import {normalizeExtensionAccess} from "../access/capabilities.js";
import {apiRequest} from "./api-client.js";

export async function getMyAccessContext(client,baseUrl) {
  const {data,error}=await client.auth.getSession();
  if(error||!data.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");
  const payload=await apiRequest({baseUrl,path:"/api/v1/access-context",token:data.session.access_token});
  try{return normalizeExtensionAccess(payload.data);}catch(error){throw new AppError(error.code||"ACCESS_CONTEXT_FAILED",error.message||"Your access context could not be loaded.");}
}
