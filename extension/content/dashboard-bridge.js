const REQUEST_TYPE = "RESUME_JD_DASHBOARD_HANDOFF";
const RESPONSE_TYPE = "RESUME_JD_EXTENSION_HANDOFF_RESULT";

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== REQUEST_TYPE || typeof event.data?.requestId !== "string") return;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "HANDOFF_APPLICATION_SESSION", payload: event.data.payload });
  } catch {
    response = { ok: false, error: { code: "EXTENSION_UNAVAILABLE", message: "The Resume JD extension could not receive the Application." } };
  }
  window.postMessage({ type: RESPONSE_TYPE, requestId: event.data.requestId, ...response }, location.origin);
});
