// Paste into Chrome DevTools > Console on a job application page, then press Enter.
// Copies the form's STRUCTURE to the clipboard: labels, field types, roles, data-automation-id / ids and the
// section each field sits in. It never reads values, typed text or the selected options of fields.
// Used to build Autofill support for job sites that need an account (Workday). Save the clipboard as a .json file.
(() => {
  const text = (value, max = 90) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const byId = (id) => (id ? document.getElementById(id) : null);
  const visible = (el) => Boolean(el.offsetParent || el.getClientRects().length);
  const labelOf = (el) => {
    const labelled = (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => text(byId(id)?.textContent)).filter(Boolean).join(" | ");
    const forLabel = el.id ? text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) : "";
    return { labelledBy: labelled, label: forLabel || text(el.closest("label")?.textContent), ariaLabel: text(el.getAttribute("aria-label")), placeholder: text(el.getAttribute("placeholder")) };
  };
  const path = (el) => {
    const parts = [];
    for (let node = el.parentElement, depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
      const mark = node.getAttribute("data-automation-id") || (node.id && !/^\d|[a-f0-9]{16}/i.test(node.id) ? `#${node.id}` : "") || (node.getAttribute("role") ? `[${node.getAttribute("role")}]` : "");
      if (mark) parts.push(mark);
    }
    return parts.join(" < ");
  };
  // Inputs never contribute text; buttons and options contribute their visible label only.
  const CONTROL = "input,textarea,select,button,[role=combobox],[role=spinbutton],[role=listbox],[role=option],[role=checkbox],[role=radio],[contenteditable=true]";
  const INTERESTING = /section|formfield|add|prompt|datesection|multiselect|selecteditem|panel|fieldset|legend|heading|label|option/i;
  const seen = new Set(), items = [];
  for (const el of document.querySelectorAll(`${CONTROL},[data-automation-id]`)) {
    const auto = el.getAttribute("data-automation-id") || "";
    const isControl = el.matches(CONTROL);
    if (!isControl && !INTERESTING.test(auto)) continue;
    if (seen.has(el)) continue; seen.add(el);
    const tag = el.tagName.toLowerCase();
    items.push({
      tag, type: el.getAttribute("type") || "", role: el.getAttribute("role") || "", auto, id: el.id || "", name: el.getAttribute("name") || "",
      ...labelOf(el),
      haspopup: el.getAttribute("aria-haspopup") || "", expanded: el.getAttribute("aria-expanded") || "", required: el.required || el.getAttribute("aria-required") === "true",
      // Visible wording of buttons, options, headings and legends only; never of inputs.
      shows: ["button", "legend", "h1", "h2", "h3", "h4", "label"].includes(tag) || /option|heading/.test(el.getAttribute("role") || "") || /legend|heading|label|title/i.test(auto) ? text(el.textContent, 60) : "",
      visible: visible(el), path: path(el),
    });
    if (items.length >= 600) break;
  }
  const snapshot = { site: location.hostname, page: location.pathname, takenAt: new Date().toISOString(), count: items.length, items };
  const json = JSON.stringify(snapshot, null, 1);
  if (typeof copy === "function") copy(json);
  console.log(`Copied the structure of ${items.length} form elements (no values). Paste it into a .json file.`);
  return snapshot.count;
})();
