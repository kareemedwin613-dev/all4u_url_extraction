const REQUEST_TYPE = "RESUME_JD_DASHBOARD_HANDOFF";
const RESPONSE_TYPE = "RESUME_JD_EXTENSION_HANDOFF_RESULT";

export function handoffApplicationSession(session, { timeoutMs = 1800, target = globalThis.window, origin = globalThis.location?.origin } = {}) {
  if (!origin || !target?.postMessage || !target?.addEventListener) return Promise.reject(Object.assign(new Error("The Resume JD extension is not available in this browser."), { code: "EXTENSION_NOT_INSTALLED" }));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener("message", receive);
      reject(Object.assign(new Error("The Resume JD extension did not respond. Install or enable it, then try again."), { code: "EXTENSION_NOT_INSTALLED" }));
    }, timeoutMs);
    function receive(event) {
      if (event.source !== target || event.origin !== origin || event.data?.type !== RESPONSE_TYPE || event.data?.requestId !== requestId) return;
      clearTimeout(timer);
      target.removeEventListener("message", receive);
      if (event.data.ok) resolve(event.data.data);
      else reject(Object.assign(new Error(event.data.error?.message || "The extension rejected the Application handoff."), { code: event.data.error?.code || "EXTENSION_HANDOFF_FAILED" }));
    }
    target.addEventListener("message", receive);
    target.postMessage({ type: REQUEST_TYPE, requestId, payload: session }, origin);
  });
}

export const dashboardBridgeTypes = Object.freeze({ request: REQUEST_TYPE, response: RESPONSE_TYPE });
