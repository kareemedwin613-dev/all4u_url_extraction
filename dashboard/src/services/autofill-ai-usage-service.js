import {normalizeError} from "../shared/errors.js";
import {authenticatedApiRequest} from "./api-client.js";

// AI Autofill usage and cost for the Overview (Admins): hourly usage in the period, month spend, settings.
export async function getAutofillAiUsage(client,apiBaseUrl,dateRange={}){
  try{
    const query=new URLSearchParams(Object.fromEntries(Object.entries(dateRange||{}).filter(([,value])=>value))).toString();
    const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/autofill-ai/usage${query?`?${query}`:""}`});
    return payload.data;
  }catch(error){throw normalizeError(error,"Unable to load AI Autofill usage.");}
}

// Each person's AI access (OFF, MATCH, DRAFT) and their AI usage in the period (Admins).
export async function getAutofillAiAppliers(client,apiBaseUrl,dateRange={}){
  try{
    const query=new URLSearchParams(Object.fromEntries(Object.entries(dateRange||{}).filter(([,value])=>value))).toString();
    const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/autofill-ai/appliers${query?`?${query}`:""}`});
    return payload.data;
  }catch(error){throw normalizeError(error,"Unable to load AI access.");}
}

export async function setAutofillAiAccess(client,apiBaseUrl,userId,level){
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:`/api/v1/autofill-ai/appliers/${encodeURIComponent(userId)}`,method:"PUT",body:{level}});return payload.data;}
  catch(error){throw normalizeError(error,"Unable to change AI access.");}
}

// Admin AI settings: on/off, provider, models, monthly cap. API keys are never sent or returned.
export async function getAutofillAiSettings(client,apiBaseUrl){
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/autofill-ai/settings"});return payload.data;}
  catch(error){throw normalizeError(error,"Unable to load AI settings.");}
}

export async function saveAutofillAiSettings(client,apiBaseUrl,settings){
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/autofill-ai/settings",method:"PUT",body:settings});return payload.data;}
  catch(error){throw normalizeError(error,"Unable to save AI settings.");}
}

export async function testAutofillAiModel(client,apiBaseUrl,{provider,model}){
  try{const{payload}=await authenticatedApiRequest(client,{baseUrl:apiBaseUrl,path:"/api/v1/autofill-ai/settings/test",method:"POST",body:{provider,model},timeoutMs:30000});return payload.data;}
  catch(error){throw normalizeError(error,"The model test failed.");}
}
