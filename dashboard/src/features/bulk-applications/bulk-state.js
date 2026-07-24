export const MAX_BULK_JDS=100;
export const MAX_BULK_COMBINATIONS=2000;
export const BULK_PAGE_SIZES=Object.freeze([25,50,100]);

export const pairKey=(jobDescriptionId,resumeId)=>`${jobDescriptionId}:${resumeId}`;
const clean=value=>String(value??"").trim();

export function defaultEligibleSelection(preview){
  return new Set((preview?.combinations||[]).filter(row=>row.eligible&&!row.existingApplicationId).map(row=>row.key));
}

export function filterBulkCombinations(rows=[],filters={}){
  const search=clean(filters.search).toLowerCase(),equals=(value,expected)=>!expected||clean(value)===clean(expected);
  return rows.filter(row=>{
    const haystack=[row.company,row.jobTitle,row.candidateName,row.resumeName].map(clean).join(" ").toLowerCase();
    if(search&&!haystack.includes(search))return false;
    if(!equals(row.company,filters.company)||!equals(row.jobCategoryId,filters.categoryId)||!equals(row.candidateName,filters.candidate)||!equals(row.resumeName,filters.resume))return false;
    if(filters.eligibility==="ELIGIBLE"&&!row.eligible)return false;
    if(filters.eligibility==="EXCLUDED"&&row.eligible)return false;
    if(filters.exclusionCode&&!equals(row.exclusionCode,filters.exclusionCode))return false;
    return true;
  });
}

export function selectEligible(rows=[],current=new Set()){
  const next=new Set(current);for(const row of rows)if(row.eligible&&!row.existingApplicationId)next.add(row.key);return next;
}

export function clearRows(rows=[],current=new Set()){
  const next=new Set(current);for(const row of rows)next.delete(row.key);return next;
}

export function selectedCombinations(preview,selectedKeys){
  return (preview?.combinations||[]).filter(row=>row.eligible&&selectedKeys.has(row.key));
}

export function bulkConfirmationCounts(preview,selectedKeys){
  const rows=selectedCombinations(preview,selectedKeys);
  return {selectedJdCount:new Set(rows.map(row=>row.jobDescriptionId)).size,selectedResumeCount:new Set(rows.map(row=>row.resumeId)).size,applicationCount:rows.length,duplicateCount:Number(preview?.duplicateCount||0)};
}

export function creationPayload(preview,selectedKeys){
  return selectedCombinations(preview,selectedKeys).map(row=>({job_description_id:row.jobDescriptionId,resume_id:row.resumeId}));
}
