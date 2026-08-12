import { appError } from "../shared/errors.js";

export async function authenticatedApiRequest(client,{baseUrl,path,method="GET",body,idempotencyKey,signal,timeoutMs=15000}) {
  const {data,error}=await client.auth.getSession();
  if(error||!data.session?.access_token)throw appError("UNAUTHORIZED","Your session has expired. Sign in again.");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),requestId=`web_${crypto.randomUUID()}`;
  if(signal)signal.addEventListener("abort",()=>controller.abort(),{once:true});
  try {
    const multipart=body instanceof FormData,headers={Authorization:`Bearer ${data.session.access_token}`,...(multipart?{}:{"Content-Type":"application/json"}),"X-Request-ID":requestId};
    if(idempotencyKey)headers["Idempotency-Key"]=idempotencyKey;
    const response=await fetch(`${String(baseUrl).replace(/\/+$/,"")}${path}`,{method,headers,body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const fieldErrors=payload.fieldErrors&&typeof payload.fieldErrors==="object"?Object.entries(payload.fieldErrors).flatMap(([field,messages])=>Array.isArray(messages)?messages.map((message)=>`${field}: ${message}`):[]):[];
      const details=fieldErrors.length?` ${fieldErrors.join(" ")}`:"";
      throw appError(payload.code||"API_REQUEST_FAILED",`${payload.message||"The API request failed."}${details}${payload.requestId?` Request ID: ${payload.requestId}`:""}`,false);
    }
    return {payload,requestId:response.headers.get("x-request-id")||payload.requestId||requestId};
  } catch(error) {
    if(error?.name==="AbortError")throw appError("API_TIMEOUT","The API request timed out.",true);
    throw error;
  } finally {clearTimeout(timer);}
}
