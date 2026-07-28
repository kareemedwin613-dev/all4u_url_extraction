import { AppError } from "../shared/errors.js";
import { apiRequest } from "./api-client.js";
export async function listIndustryDomains(client,baseUrl){const {data,error}=await client.auth.getSession();if(error||!data.session?.access_token)throw new AppError("SESSION_EXPIRED","Your session has expired. Sign in again.");const payload=await apiRequest({baseUrl,path:"/api/v1/lookups/industry-domains",token:data.session.access_token});return payload.data||[];}
