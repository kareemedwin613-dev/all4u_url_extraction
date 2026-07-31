import { selectJobSiteAdapter } from "../adapters/adapter-registry.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

if (!globalThis.__resumeJdUploadBridgeInstalled) {
  globalThis.__resumeJdUploadBridgeInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== MESSAGE_TYPES.ATTACH_RESUME_TO_PAGE) return false;
    Promise.resolve().then(()=>{const selected=selectJobSiteAdapter(location.href),result=selected.adapter.attachResume({root:document,payload:message.payload});return{...result,adapter:{id:selected.id,version:selected.version,label:selected.label,tier:selected.tier}};}).then(sendResponse).catch(() => sendResponse({ status: "FAILED", code: "RESUME_ATTACHMENT_FAILED" }));
    return true;
  });
}
