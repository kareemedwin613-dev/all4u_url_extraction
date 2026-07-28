import { AppError } from "../shared/errors.js";

export function validateApiBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch {}
  const local = url && ["localhost", "127.0.0.1"].includes(url.hostname);
  const valid = Boolean(url && !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" || (local && url.protocol === "http:")));
  return { valid, normalized: valid ? url.toString().replace(/\/+$/, "") : "", error: valid ? "" : "Enter an HTTPS API base URL, or HTTP localhost for development." };
}

export async function apiRequest({ baseUrl, path, token, method = "GET", body, idempotencyKey, timeoutMs = 15000, fetchImpl = fetch }) {
  const config = validateApiBaseUrl(baseUrl);
  if (!config.valid) throw new AppError("API_NOT_CONFIGURED", "The backend API URL is not configured.", config.error);
  if (!token) throw new AppError("SESSION_EXPIRED", "Your session has expired. Sign in again.");
  const multipart=body instanceof FormData,requestId = `ext_${crypto.randomUUID()}`, headers = { Authorization: `Bearer ${token}`, ...(multipart?{}:{"Content-Type":"application/json"}), "X-Request-ID": requestId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const attempt = async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.normalized}${path}`, { method, headers, body: body === undefined ? undefined : multipart?body:JSON.stringify(body), signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code=[502,503,504].includes(response.status)?"API_TRANSIENT":payload.code||"API_REQUEST_FAILED";
        const reason=payload.details?.reason?`Reason: ${payload.details.reason}. `:"",fields=payload.fieldErrors&&typeof payload.fieldErrors==="object"?Object.entries(payload.fieldErrors).flatMap(([field,messages])=>(messages||[]).map(message=>`${field}: ${message}`)).join(" "):"";
        throw new AppError(code, payload.message || "The API request failed.", `${reason}${fields?`${fields} `:""}${payload.requestId ? `Request ID: ${payload.requestId}` : ""}`.trim());
      }
      return payload;
    } finally { clearTimeout(timer); }
  };
  try { return await attempt(); }
  catch (error) {
    const transient = error?.name === "AbortError" || error instanceof TypeError || error?.code === "API_TRANSIENT";
    if (method === "POST" && idempotencyKey && transient) return attempt();
    if (error?.name === "AbortError") throw new AppError("API_TIMEOUT", "The backend API did not respond in time.");
    throw error;
  }
}
