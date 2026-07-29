import { detectPersonalFields, fillPersonalFields } from "../autofill/personal-field-adapter.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

if (!globalThis.__resumeJdPersonalAutofillInstalled) {
  globalThis.__resumeJdPersonalAutofillInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    if (message?.type === MESSAGE_TYPES.DETECT_PERSONAL_AUTOFILL_FIELDS) {
      Promise.resolve(detectPersonalFields(document, message.payload?.availableKeys || [])).then((fields) => sendResponse({ status: "DETECTED", fields }));
      return true;
    }
    if (message?.type === MESSAGE_TYPES.FILL_PERSONAL_AUTOFILL_FIELDS) {
      Promise.resolve(fillPersonalFields(message.payload?.fields || [], document)).then((results) => sendResponse({ status: "FILLED", results }));
      return true;
    }
    return false;
  });
}

