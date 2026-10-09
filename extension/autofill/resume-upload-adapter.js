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
  // Workable marks its unlabeled upload with data-ui="resume".
  return [input.name, input.id, input.getAttribute?.("aria-label"), input.getAttribute?.("placeholder"), input.getAttribute?.("title"),
    input.getAttribute?.("data-ui"), input.getAttribute?.("data-testid"), input.getAttribute?.("data-automation-id"), labelText, wrappingLabel].map(text).filter(Boolean).join(" ");
}

// The section an upload sits in, when the word "Resume" is a few levels above it (Workday's drop zone under an
// "Autofill with Resume" or "Resume/CV" heading). Only a small section that holds no other upload counts, so a
// resume never lands in a cover letter or "other documents" upload.
// textContent runs neighbouring elements together ("Autofill with ResumeDrop file here"), which would hide whole
// words such as "Resume" or "cover letter"; this keeps a space between elements.
function spacedText(node, limit = 1200) {
  const parts = [];
  let length = 0;
  (function walk(current) {
    for (const child of current?.childNodes || []) {
      if (length > limit) return;
      if (child.nodeType === 3) { const value = text(child.nodeValue); if (value) { parts.push(value); length += value.length + 1; } }
      else if (child.nodeType === 1 && !/^(script|style|template)$/i.test(child.tagName || "")) walk(child);
    }
  })(node);
  return parts.join(" ");
}

function sectionMentions(input, wanted, other) {
  let node = input.parentElement?.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    if ((node.querySelectorAll?.('input[type="file"]')?.length || 0) > 1) return false;
    const content = spacedText(node);
    if (content.length > 1000) return false;
    if (wanted.test(content)) return !other.test(content);
  }
  return false;
}
const sectionMentionsResume = (input) => sectionMentions(input, RESUME_TERMS, COVER_LETTER_TERMS);

export function scoreResumeUploadInput(input) {
  if (!input || String(input.type).toLowerCase() !== "file" || input.disabled) return -1;
  const direct = directDescriptor(input), context = text(input.parentElement?.textContent).slice(0, 500), accept = text(input.accept);
  if (COVER_LETTER_TERMS.test(direct)) return -1;
  let score = RESUME_TERMS.test(direct) ? 80 : RESUME_TERMS.test(context) && !COVER_LETTER_TERMS.test(context) ? 70 : 0;
  if (!score && sectionMentionsResume(input)) score = 70;
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

// A cover letter upload names the cover letter itself, or sits alone in a small section that does (Gem:
// <span>Cover letter</span> above the drop zone). An upload that also mentions the Resume never qualifies.
export function scoreCoverLetterUploadInput(input) {
  if (!input || String(input.type).toLowerCase() !== "file" || input.disabled) return -1;
  const direct = directDescriptor(input), context = text(input.parentElement?.textContent).slice(0, 500), accept = text(input.accept);
  if (RESUME_TERMS.test(direct)) return -1;
  let score = COVER_LETTER_TERMS.test(direct) ? 80 : COVER_LETTER_TERMS.test(context) && !RESUME_TERMS.test(context) ? 70 : 0;
  if (!score && sectionMentions(input, COVER_LETTER_TERMS, RESUME_TERMS)) score = 70;
  if (!score) return 0;
  if (/\.pdf|application\/pdf|\.docx|wordprocessingml|text\/plain/i.test(accept)) score += 15;
  if (input.multiple) score -= 10;
  return score;
}

export function detectCoverLetterUploadInputs(root = document) {
  return [...root.querySelectorAll('input[type="file"]')]
    .map((input) => ({ input, score: scoreCoverLetterUploadInput(input) }))
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

// Some forms keep the file input hidden until "Attach resume" is chosen over "Paste resume" (JazzHR).
// Clicking that option shows the input, so the reviewer sees the attached file. Only in-page links
// (href="#") and plain buttons are clicked, never anything that navigates or submits.
const REVEAL_TEXT = /^(?:attach|upload|choose|add)\b[^]{0,30}$/i;
function safeRevealControl(element) {
  const tag = String(element?.tagName || "").toLowerCase();
  if (tag === "button") return String(element.getAttribute?.("type") || "").toLowerCase() === "button";
  if (tag === "a") return /^(#.*|javascript:void\(0\);?)?$/i.test(String(element.getAttribute?.("href") ?? "#").trim());
  return String(element?.getAttribute?.("role") || "").toLowerCase() === "button";
}
export function revealResumeInput(input) {
  if (typeof input?.getClientRects !== "function" || input.getClientRects().length > 0) return false;
  let node = input.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const control = [...node.querySelectorAll("a,button,[role='button']")]
      .find((item) => REVEAL_TEXT.test(text(item.textContent)) && !COVER_LETTER_TERMS.test(text(item.textContent)) && safeRevealControl(item));
    if (control) { control.click(); return true; }
  }
  return false;
}

// The Resume or the cover letter, each only into its own upload. A file the upload already shows (same name)
// is left alone, so running Autofill again on the same page never attaches it twice.
function attachDocumentPayload(payload, root, detect, label) {
  let bytes;
  const code = (value) => label === "Resume" ? value : value.replace(/^RESUME_/, "COVER_LETTER_");
  try {
    if (!payload || typeof payload.base64 !== "string" || payload.base64.length > 8 * 1024 * 1024) return { status: "FAILED", code: code("RESUME_PAYLOAD_INVALID") };
    bytes = decodeBase64(payload.base64);
    const file = new File([bytes], text(payload.filename), { type: text(payload.mimeType), lastModified: Date.now() });
    if (file.size !== Number(payload.fileSizeBytes)) return { status: "FAILED", code: code("RESUME_PAYLOAD_SIZE_MISMATCH") };
    const candidates = detect(root);
    if (!candidates.length) return { status: "UNSUPPORTED", code: code("RESUME_INPUT_NOT_FOUND"), message: `No ${label} upload was found on this page.` };
    const confidence = Math.min(100, candidates[0].score);
    if (verifyResumeUpload(candidates[0].input, file)) return { status: "ATTACHED", code: code("RESUME_ALREADY_ATTACHED"), confidence };
    if (label === "Resume") revealResumeInput(candidates[0].input);
    const result = attachResumeFile(candidates[0].input, file);
    return { ...result, code: code(result.code), confidence };
  } catch {
    return { status: "FAILED", code: code("RESUME_ATTACHMENT_FAILED"), message: `The ${label} could not be attached to this page.` };
  } finally { bytes?.fill(0); }
}

// detect lets an ATS adapter add its own rule for which upload is the Resume (Workday).
export function attachResumePayload(payload, root = document, detect = detectResumeUploadInputs) {
  return attachDocumentPayload(payload, root, detect, "Resume");
}

export function attachCoverLetterPayload(payload, root = document) {
  return attachDocumentPayload(payload, root, detectCoverLetterUploadInputs, "cover letter");
}
