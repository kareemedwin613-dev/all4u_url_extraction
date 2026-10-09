import { selectJobSiteAdapter } from "../adapters/adapter-registry.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

function adapterSummary(selected) { return { id: selected.id, version: selected.version, label: selected.label, tier: selected.tier }; }

function detectAutofillFields(payload) {
  const selected=selectJobSiteAdapter(location.href);
  const applicationAnswers=Object.freeze((payload?.applicationAnswers||[]).map(answer=>Object.freeze({...answer,questionPatterns:Object.freeze([...(answer.questionPatterns||[])])})));
  const guideEntries=Object.freeze((payload?.guideEntries||[]).map(entry=>Object.freeze({...entry,patterns:Object.freeze([...(entry.patterns||[])])})));
  const personalWordings=Object.freeze(Object.fromEntries(Object.entries(payload?.personalWordings&&typeof payload.personalWordings==="object"?payload.personalWordings:{}).map(([key,list])=>[key,Object.freeze([...(Array.isArray(list)?list:[])])])));
  const context=Object.freeze({root:document,availableKeys:Object.freeze([...(payload?.availableKeys||[])]),applicationAnswers,guideEntries,personalWordings});
  const result=selected.adapter.detectFields(context);
  // Whether the page has a cover letter upload, so the panel fetches the cover letter file only when it can be attached.
  const coverLetterUpload=(selected.adapter.detectCoverLetterField?.({root:document})?.confidence??-1)>=70;
  return {status:"DETECTED",...result,coverLetterUpload,origin:location.origin,adapter:adapterSummary(selected)};
}

if (!globalThis.__resumeJdPersonalAutofillInstalled) {
  globalThis.__resumeJdPersonalAutofillInstalled = true;
  // Probed in every frame by the service worker, which fills only the frame holding the application form.
  globalThis.__resumeJdAutofillProbe = (payload) => detectAutofillFields(payload);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (message?.type === MESSAGE_TYPES.DETECT_PERSONAL_AUTOFILL_FIELDS) {
      Promise.resolve().then(()=>sendResponse(detectAutofillFields(message.payload)));
      return true;
    }
    if (message?.type === MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL_FIELDS) {
      const fields = message.payload?.fields || [];
      Promise.resolve().then(async()=>{const selected=selectJobSiteAdapter(location.href);if(message.payload?.adapterId&&message.payload.adapterId!==selected.id)return{status:"ADAPTER_CHANGED",results:[]};const results=await selected.adapter.fillFields(Object.freeze({root:document,fields:Object.freeze(fields.map(field=>Object.freeze({...field}))),sections:Object.freeze(message.payload?.sections||{})}));return{status:"FILLED",results,adapter:adapterSummary(selected)};}).then(sendResponse);
      return true;
    }
    return false;
  });
}
