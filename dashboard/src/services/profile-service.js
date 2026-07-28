import {normalizeAccessError} from "./admin-user-service.js";
import {authenticatedApiRequest} from "./api-client.js";

export async function updateMyProfile(client,apiBaseUrl, fullName) {
  const value = String(fullName || "").trim();
  if (value.length > 200) throw {code: "VALIDATION_ERROR", message: "Full name must be at most 200 characters.", retryable: false};
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/profile",method:"PATCH",body:{fullName:value}});return payload.data;}
  catch(error){throw normalizeAccessError(error);}
}
