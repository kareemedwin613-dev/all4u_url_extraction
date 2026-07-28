import {normalizeError} from "../shared/errors.js";
import {authenticatedApiRequest} from "./api-client.js";
export async function getBusinessOverview(client,apiBaseUrl){try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/business-overview"});return payload.data;}catch(error){throw normalizeError(error,"Unable to load the business overview.");}}
