import {normalizeError} from "../shared/errors.js";
import {authenticatedApiRequest} from "./api-client.js";
export async function getBusinessOverview(client,apiBaseUrl,dateRange={}){try{const query=new URLSearchParams(dateRange).toString(),{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/business-overview${query?`?${query}`:""}`});return payload.data;}catch(error){throw normalizeError(error,"Unable to load the business overview.");}}
