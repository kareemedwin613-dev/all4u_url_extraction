import { selectJobSiteAdapter } from "../adapters/adapter-registry.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

if (!globalThis.__resumeJdPersonalAutofillInstalled) {
  globalThis.__resumeJdPersonalAutofillInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (message?.type === MESSAGE_TYPES.DETECT_PERSONAL_AUTOFILL_FIELDS) {
      Promise.resolve().then(()=>{
        const selected=selectJobSiteAdapter(location.href);
        const applicationAnswers=Object.freeze((message.payload?.applicationAnswers||[]).map(answer=>Object.freeze({...answer,questionPatterns:Object.freeze([...(answer.questionPatterns||[])])})));
        const context=Object.freeze({root:document,availableKeys:Object.freeze([...(message.payload?.availableKeys||[])]),applicationAnswers});
        const result=selected.adapter.detectFields(context);
        return sendResponse({status:"DETECTED",...result,adapter:{id:selected.id,version:selected.version,label:selected.label,tier:selected.tier}});
      });
      return true;
    }
    if (message?.type === MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL_FIELDS) {
      const fields = message.payload?.fields || [];
      Promise.resolve().then(async()=>{const selected=selectJobSiteAdapter(location.href);if(message.payload?.adapterId&&message.payload.adapterId!==selected.id)return{status:"ADAPTER_CHANGED",results:[]};const results=await selected.adapter.fillFields(Object.freeze({root:document,fields:Object.freeze(fields.map(field=>Object.freeze({...field})))}));return{status:"FILLED",results,adapter:{id:selected.id,version:selected.version,label:selected.label,tier:selected.tier}};}).then(sendResponse);
      return true;
    }
    return false;
  });
}
