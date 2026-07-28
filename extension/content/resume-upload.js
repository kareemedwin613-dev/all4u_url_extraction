import { attachResumePayload } from "../autofill/resume-upload-adapter.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

if (!globalThis.__resumeJdUploadBridgeInstalled) {
  globalThis.__resumeJdUploadBridgeInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== MESSAGE_TYPES.ATTACH_RESUME_TO_PAGE) return false;
    Promise.resolve(attachResumePayload(message.payload)).then(sendResponse).catch(() => sendResponse({ status: "FAILED", code: "RESUME_ATTACHMENT_FAILED" }));
    return true;
  });
}
