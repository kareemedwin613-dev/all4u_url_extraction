const OUTCOMES = new Set(["VERIFIED", "FAILED", "SKIPPED"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

export function mergeAutofillResults(previous = [], next = []) {
  const results = new Map(previous.map((result) => [result.fieldId, result]));
  for (const result of next) if (typeof result?.fieldId === "string") results.set(result.fieldId, result);
  return [...results.values()];
}

export function mapAutofillRecovery(fields=[],recoveryFields=[]){
 const indexes=new Map(),lookup=new Map((recoveryFields||[]).map(item=>[`${item.fieldKey}:${item.fieldIndex}`,item]));
 return (fields||[]).map(field=>{const index=indexes.get(field.key)||0;indexes.set(field.key,index+1);const item=lookup.get(`${field.key}:${index}`);if(!item||!OUTCOMES.has(item.outcome))return null;return{fieldId:field.fieldId,key:field.key,status:item.outcome,...(item.errorCode?{code:item.errorCode}:{})};}).filter(Boolean);
}

export function buildAutofillTelemetry({ resumeUpdatedAt, adapter, targetDomain, fields = [], selectedFieldIds = [], results = [], unresolved = [] }) {
  const selected = new Set(selectedFieldIds);
  const resultById = new Map(results.map((result) => [result.fieldId, result]));
  const sanitized = [];
  const indexes = new Map();
  let succeededCount = 0;
  let failedCount = 0;

  for (const field of fields) {
    if (typeof field?.fieldId !== "string" || typeof field?.key !== "string") continue;
    const isSelected = selected.has(field.fieldId);
    const result = resultById.get(field.fieldId);
    let outcome = "DETECTED";
    let errorCode;
    if (isSelected) {
      outcome = OUTCOMES.has(result?.status) ? result.status : "FAILED";
      if (outcome === "VERIFIED") succeededCount += 1;
      else failedCount += 1;
      const code = String(result?.code || (outcome === "FAILED" ? "FIELD_RESULT_MISSING" : ""));
      if (SAFE_CODE.test(code)) errorCode = code;
    }
    const fieldIndex = indexes.get(field.key) || 0;
    indexes.set(field.key, fieldIndex + 1);
    const item = { fieldKey: field.key, fieldIndex, confidence: Math.max(0, Math.min(100, Math.round(Number(field.confidence) || 0))), outcome };
    if (errorCode) item.errorCode = errorCode;
    sanitized.push(item);
  }

  const detectedIds = new Set(fields.map((field) => field?.fieldId).filter((id) => typeof id === "string"));
  const selectedCount = [...selected].filter((id) => detectedIds.has(id)).length;
  return {
    resumeUpdatedAt,
    adapterId: String(adapter?.id || "generic-html"),
    adapterVersion: String(adapter?.version || "1.0.0"),
    targetDomain: String(targetDomain || "").toLowerCase(),
    detectedCount: detectedIds.size,
    selectedCount,
    succeededCount,
    failedCount,
    unresolvedCount: Math.min(100, Array.isArray(unresolved) ? unresolved.length : 0),
    fields: sanitized,
  };
}
