// Fills AI-drafted answers ("draft.<ref>") into the text boxes the unanswered-question scan referenced.
// Each drafted box is outlined so a reviewer can find it; the outline goes once a person types in it.
import { fillControl } from "./personal-field-adapter.js";
import { UNRESOLVED_REF_ATTRIBUTE } from "./screening-field-adapter.js";

export const AI_DRAFT_ATTRIBUTE = "data-resume-jd-ai-draft";

export function fillDraftFields(requests = [], root = document) {
  return requests.map((request) => {
    const ref = String(request?.key || "").slice("draft.".length);
    const element = /^[A-Za-z0-9_-]{1,60}$/.test(ref) ? root.querySelector?.(`[${UNRESOLVED_REF_ATTRIBUTE}="${ref}"]`) : null;
    if (!element) return { fieldId: request.fieldId, key: request.key, status: "FAILED", code: "FIELD_NOT_FOUND" };
    if (!String(request.value ?? "").trim()) return { fieldId: request.fieldId, key: request.key, status: "SKIPPED", code: "VALUE_UNAVAILABLE" };
    const ok = fillControl(element, request.key, request.value);
    if (ok) {
      element.setAttribute(AI_DRAFT_ATTRIBUTE, "true");
      if (element.style) { element.style.outline = "2px dashed #7c3aed"; element.style.outlineOffset = "2px"; }
      element.addEventListener?.("input", function clear(event) {
        if (!event.isTrusted) return;
        element.removeAttribute(AI_DRAFT_ATTRIBUTE);
        if (element.style) { element.style.outline = ""; element.style.outlineOffset = ""; }
        element.removeEventListener("input", clear);
      });
    }
    return { fieldId: request.fieldId, key: request.key, status: ok ? "VERIFIED" : "FAILED", code: ok ? "FIELD_VERIFIED" : "FIELD_VERIFICATION_FAILED" };
  });
}
