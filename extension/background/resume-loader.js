const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export async function downloadResumeBytes(access, fetchImpl = fetch) {
  const signed = new URL(String(access?.signedUrl || ""));
  if (signed.protocol !== "https:") throw new Error("RESUME_URL_INVALID");
  const expiresAt = Date.parse(String(access?.expiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 2 * 60 * 1000) throw new Error("RESUME_ACCESS_EXPIRED");
  const mimeType = String(access.mimeType || "");
  const expectedSize = Number(access.fileSizeBytes);
  if (!RESUME_MIME_TYPES.has(mimeType) || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_RESUME_BYTES || !String(access.filename || "").trim()) {
    throw new Error("RESUME_METADATA_INVALID");
  }
  const response = await fetchImpl(signed.toString(), { method: "GET", credentials: "omit", cache: "no-store", redirect: "follow" });
  if (response.status === 401 || response.status === 403) throw new Error("RESUME_ACCESS_EXPIRED");
  if (!response.ok) throw new Error("RESUME_DOWNLOAD_FAILED");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESUME_BYTES) throw new Error("RESUME_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedSize || bytes.byteLength > MAX_RESUME_BYTES) throw new Error("RESUME_SIZE_MISMATCH");
  return { bytes, filename: String(access.filename), mimeType, fileSizeBytes: bytes.byteLength };
}

export class MemoryResumeStore {
  #items = new Map();
  get(sessionId) { return this.#items.get(sessionId) || null; }
  put(sessionId, value) { this.clear(sessionId); this.#items.set(sessionId, value); }
  status(sessionId) {
    const loaded = this.get(sessionId);
    return loaded ? { ready: true, sessionId, applicationId: loaded.applicationId, filename: loaded.filename, mimeType: loaded.mimeType, fileSizeBytes: loaded.fileSizeBytes, loadedAt: loaded.loadedAt } : { ready: false, sessionId };
  }
  createFile(sessionId) {
    const loaded = this.get(sessionId);
    if (!loaded) throw new Error("The Resume is not loaded.");
    return new File([loaded.bytes], loaded.filename, { type: loaded.mimeType, lastModified: Date.now() });
  }
  clear(sessionId) {
    const loaded = this.#items.get(sessionId);
    if (loaded?.bytes instanceof Uint8Array) loaded.bytes.fill(0);
    this.#items.delete(sessionId);
  }
  clearAll() { for (const sessionId of this.#items.keys()) this.clear(sessionId); }
}
