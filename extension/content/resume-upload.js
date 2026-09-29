import { selectJobSiteAdapter } from "../adapters/adapter-registry.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

function adapterSummary(selected) { return { id: selected.id, version: selected.version, label: selected.label, tier: selected.tier }; }

if (!globalThis.__resumeJdUploadBridgeInstalled) {
  globalThis.__resumeJdUploadBridgeInstalled = true;
  // Probed in every frame by the service worker, which attaches only in the frame with the strongest
  // Resume input (e.g. a Greenhouse application embedded as an iframe on a company careers page).
  globalThis.__resumeJdResumeUploadProbe = () => {
    const selected = selectJobSiteAdapter(location.href), candidate = selected.adapter.detectResumeField({ root: document });
    return { origin: location.origin, confidence: candidate?.confidence ?? -1, adapter: adapterSummary(selected) };
  };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== MESSAGE_TYPES.ATTACH_RESUME_TO_PAGE) return false;
    Promise.resolve().then(()=>{const selected=selectJobSiteAdapter(location.href),result=selected.adapter.attachResume({root:document,payload:message.payload});return{...result,adapter:adapterSummary(selected)};}).then(sendResponse).catch(() => sendResponse({ status: "FAILED", code: "RESUME_ATTACHMENT_FAILED" }));
    return true;
  });
}
