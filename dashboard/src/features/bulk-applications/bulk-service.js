import {paginationMeta} from "../../shared/pagination.js";
import {MAX_BULK_COMBINATIONS,MAX_BULK_JDS} from "./bulk-state.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages={BULK_NO_JDS:"Select at least one job description.",BULK_JD_LIMIT:`You can select up to ${MAX_BULK_JDS} job descriptions in one bulk operation.`,BULK_NO_COMBINATIONS:"Select at least one eligible combination.",BULK_COMBINATION_LIMIT:`You can create up to ${MAX_BULK_COMBINATIONS.toLocaleString()} Applications in one bulk operation.`,BULK_BATCH_NAME_INVALID:"Batch name cannot exceed 120 characters.",BULK_BATCH_NOT_FOUND:"The Application batch was not found.",APPLICATION_ACCESS_DENIED:"Applying Manager or Admin access is required.",AUTH_REQUIRED:"Your session expired. Sign in again."};

export function normalizeBulkError(error,fallback="The bulk Application request could not be completed."){
  const raw=String(error?.message||""),upper=raw.toUpperCase(),code=Object.keys(messages).find(value=>upper.includes(value))||(error?.code==="42501"?"APPLICATION_ACCESS_DENIED":/JWT|AUTH|401/.test(upper)?"AUTH_REQUIRED":/FETCH|NETWORK|LOAD FAILED/.test(upper)?"NETWORK_INTERRUPTION":"BULK_REQUEST_FAILED");
  return {code,message:code==="NETWORK_INTERRUPTION"?"The network connection was interrupted. Check Batch History before retrying so a completed request is not submitted twice.":messages[code]||fallback,retryable:code==="NETWORK_INTERRUPTION"};
}

async function rpc(client,name,args,fallback){const {data,error}=await client.rpc(name,args);if(error)throw normalizeBulkError(error,fallback);return data;}

export async function previewBulkApplications(client,jobIds){
  const ids=[...new Set((jobIds||[]).filter(id=>UUID.test(String(id))))];
  if(!ids.length)throw normalizeBulkError(new Error("BULK_NO_JDS"));
  if(ids.length>MAX_BULK_JDS)throw normalizeBulkError(new Error("BULK_JD_LIMIT"));
  return rpc(client,"preview_bulk_applications",{p_selected_jd_ids:ids},"Unable to generate the bulk preview.");
}

export async function createBulkApplications(client,combinations,batchName=""){
  if(!Array.isArray(combinations)||!combinations.length)throw normalizeBulkError(new Error("BULK_NO_COMBINATIONS"));
  if(combinations.length>MAX_BULK_COMBINATIONS)throw normalizeBulkError(new Error("BULK_COMBINATION_LIMIT"));
  if(String(batchName).trim().length>120)throw normalizeBulkError(new Error("BULK_BATCH_NAME_INVALID"));
  return rpc(client,"create_applications_bulk",{p_combinations:combinations,p_batch_name:String(batchName).trim()||null},"Unable to create the bulk Applications.");
}

export async function listApplicationBatches(client,{search="",status="",sort="created_desc",page=1,pageSize=25}={}){
  const size=[25,50,100].includes(Number(pageSize))?Number(pageSize):25,current=Math.max(1,Number(page)||1),data=await rpc(client,"list_application_batches_v2",{p_search:String(search).trim().slice(0,100),p_status:status||"",p_sort:sort||"created_desc",p_limit:size,p_offset:(current-1)*size},"Unable to load Application batches.");
  return {...data,...paginationMeta(data?.total,current,size)};
}

export const listApplicationBatchOptions=(client,limit=200)=>rpc(client,"list_application_batch_options",{p_limit:limit},"Unable to load Application batch filters.");
export const getApplicationBatch=(client,id)=>rpc(client,"get_application_batch_detail",{p_batch_id:id},"Unable to load the Application batch.");
