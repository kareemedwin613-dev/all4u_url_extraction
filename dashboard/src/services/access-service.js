import {normalizeAccessContext, accessError} from "../access/access-context.js";
import {normalizeAccessError} from "./admin-user-service.js";
import {authenticatedApiRequest} from "./api-client.js";

export async function getMyAccessContext(client,apiBaseUrl) {
  try {
    const {payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/access-context"});
    return normalizeAccessContext(payload.data);
  } catch (error) {
    if (error?.code === "ACCESS_CONTEXT_FAILED") throw error;
    const normalized = normalizeAccessError(error, "ACCESS_CONTEXT_FAILED", "Your access context could not be loaded.");
    throw accessError(normalized.code, normalized.message, normalized.retryable);
  }
}

export async function listSystemRoles(client,apiBaseUrl) {
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/admin/roles"});return payload.data||[];}
  catch(error){throw normalizeAccessError(error,"DATA_REQUEST_FAILED","System roles could not be loaded.");}
}
