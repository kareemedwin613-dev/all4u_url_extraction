const RESUME_TERMS = /(?<![\p{L}\p{N}])(?:resume|résumé|cv|curriculum\s+vitae)(?![\p{L}\p{N}])/iu;
const COVER_LETTER_TERMS = /(?<![\p{L}\p{N}])(?:cover\s+letter|motivation\s+letter)(?![\p{L}\p{N}])/iu;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt"]);
const MAX_BYTES = 5 * 1024 * 1024;

function text(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function extension(filename) { return text(filename).split(".").pop()?.toLowerCase() || ""; }
function nearbyText(input) {
  const labelText = [...(input.labels || [])].map((label) => text(label.textContent)).join(" ");
  const wrappingLabel = text(input.closest?.("label")?.textContent);
  const parent = text(input.parentElement?.textContent).slice(0, 500);
  return [labelText, wrappingLabel, parent].filter(Boolean).join(" ");
}
function directDescriptor(input) {
  const labelText = [...(input.labels || [])].map((label) => text(label.textContent)).join(" ");
  const wrappingLabel = text(input.closest?.("label")?.textContent);
  return [input.name, input.id, input.getAttribute?.("aria-label"), input.getAttribute?.("placeholder"), input.getAttribute?.("title"), labelText, wrappingLabel].map(text).filter(Boolean).join(" ");
}

export function scoreResumeUploadInput(input) {
  if (!input || String(input.type).toLowerCase() !== "file" || input.disabled) return -1;
  const direct = directDescriptor(input), context = text(input.parentElement?.textContent).slice(0, 500), accept = text(input.accept);
  if (COVER_LETTER_TERMS.test(direct)) return -1;
  let score = RESUME_TERMS.test(direct) ? 80 : RESUME_TERMS.test(context) && !COVER_LETTER_TERMS.test(context) ? 70 : 0;
  if (/\.pdf|application\/pdf|\.docx|wordprocessingml|text\/plain/i.test(accept)) score += 15;
  if (input.multiple) score -= 10;
  if (input.required) score += 2;
  return score;
}

export function detectResumeUploadInputs(root = document) {
  return [...root.querySelectorAll('input[type="file"]')]
    .map((input) => ({ input, score: scoreResumeUploadInput(input) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);
}

function accepts(input, file) {
  const accept = text(input?.accept);
  if (!accept) return true;
  const values = accept.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
  const ext = `.${extension(file.name)}`, mime = file.type.toLowerCase();
  return values.some((value) => value === ext || value === mime || value === "*/*" || (value.endsWith("/*") && mime.startsWith(value.slice(0, -1))));
}

export function validateResumeFile(file, input) {
  if (!file) return { valid: false, code: "RESUME_FILE_MISSING" };
  if (!ALLOWED_MIME_TYPES.has(String(file.type || "")) || !ALLOWED_EXTENSIONS.has(extension(file.name))) return { valid: false, code: "RESUME_FILE_TYPE_UNSUPPORTED" };
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_BYTES) return { valid: false, code: "RESUME_FILE_SIZE_INVALID" };
  if (input && !accepts(input, file)) return { valid: false, code: "RESUME_INPUT_REJECTS_FILE" };
  return { valid: true, code: "RESUME_FILE_VALID" };
}

export function attachResumeFile(input, file) {
  const validation = validateResumeFile(file, input);
  if (!validation.valid) return { status: "FAILED", code: validation.code };
  if (typeof DataTransfer !== "function") return manualResumeFallback(input, "DATA_TRANSFER_UNAVAILABLE");
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const nativeSetter = typeof HTMLInputElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set : null;
    if (nativeSetter) nativeSetter.call(input, transfer.files); else input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return verifyResumeUpload(input, file) ? { status: "ATTACHED", code: "RESUME_ATTACHED" } : manualResumeFallback(input, "ATTACHMENT_NOT_VERIFIED");
  } catch {
    return manualResumeFallback(input, "PROGRAMMATIC_ATTACHMENT_BLOCKED");
  }
}

export function verifyResumeUpload(input, file) {
  const attached = input?.files?.[0];
  if (attached && attached.name === file.name && attached.size === file.size) return true;
  return nearbyText(input).toLowerCase().includes(file.name.toLowerCase());
}

export function manualResumeFallback(input, code = "MANUAL_ATTACHMENT_REQUIRED") {
  try { input?.scrollIntoView?.({ block: "center", behavior: "smooth" }); input?.focus?.({ preventScroll: true }); } catch {}
  return { status: "MANUAL_REQUIRED", code, message: "Open the job site's Application form or Application tab, then retry. If automatic attachment is unsupported, use the highlighted file chooser manually." };
}

function decodeBase64(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function attachResumePayload(payload, root = document) {
  let bytes;
  try {
    if (!payload || typeof payload.base64 !== "string" || payload.base64.length > 8 * 1024 * 1024) return { status: "FAILED", code: "RESUME_PAYLOAD_INVALID" };
    bytes = decodeBase64(payload.base64);
    const file = new File([bytes], text(payload.filename), { type: text(payload.mimeType), lastModified: Date.now() });
    if (file.size !== Number(payload.fileSizeBytes)) return { status: "FAILED", code: "RESUME_PAYLOAD_SIZE_MISMATCH" };
    const candidates = detectResumeUploadInputs(root);
    if (!candidates.length) return { status: "UNSUPPORTED", code: "RESUME_INPUT_NOT_FOUND", message: "No standard Resume file input was found on this page." };
    const result = attachResumeFile(candidates[0].input, file);
    return { ...result, confidence: Math.min(100, candidates[0].score) };
  } catch {
    return { status: "FAILED", code: "RESUME_ATTACHMENT_FAILED", message: "The Resume could not be attached to this page." };
  } finally { bytes?.fill(0); }
}
