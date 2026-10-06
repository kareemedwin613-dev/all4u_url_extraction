// Where a control sits in an application form. Employment and education entries repeat, and a
// "Location" or "Start date" inside one of them means something different from the same label in
// personal details or a screening question.
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// Class names and ids must name the section explicitly ("job-position-page" is not a job entry);
// headings may use the shorter words a person reads ("Experience", "Education").
const EMPLOYMENT_ATTRIBUTE = /(employment|work[\s_-]*experience|work[\s_-]*history|professional[\s_-]*experience)/i;
const EDUCATION_ATTRIBUTE = /(education|school)/i;
const EMPLOYMENT_HEADING = /^(?:work\s+|professional\s+|relevant\s+)?(?:experience|employment|work\s+history)\b/i;
const EDUCATION_HEADING = /^(?:education|academic|school)\b/i;
const INDEXED_EMPLOYMENT = /(?:employments?|work[\s_-]*experiences?|experiences?|work[\s_-]*history|positions?)\W{0,3}(\d{1,2})(?!\d)/i;
const INDEXED_EDUCATION = /(?:educations?|schools?|degrees?)\W{0,3}(\d{1,2})(?!\d)/i;
const MAX_ANCESTORS = 8;
// A container with this many controls is the whole form, not one entry.
const FORM_SIZED = 25;

function attributeText(element) {
  return [element?.getAttribute?.("data-automation-id"), element?.getAttribute?.("aria-label"), element?.id, typeof element?.className === "string" ? element.className : ""]
    .map(clean).filter(Boolean).join(" ");
}

function headingText(container) {
  const heading = [...(container?.children || [])].find((child) => /^(h[1-4]|legend)$/i.test(String(child.tagName || "")) || child.getAttribute?.("role") === "heading");
  return clean(heading?.textContent).slice(0, 120);
}

// { kind: "employment" | "education" | null, index: number | null } where index is the number the
// page itself uses (0- or 1-based); callers rank indexes rather than trusting their base.
export function formSection(element) {
  const own = [element?.name, element?.id, element?.getAttribute?.("data-automation-id")].map(clean).join(" ");
  const employmentIndex = own.match(INDEXED_EMPLOYMENT), educationIndex = own.match(INDEXED_EDUCATION);
  if (educationIndex) return { kind: "education", index: Number(educationIndex[1]) };
  if (employmentIndex) return { kind: "employment", index: Number(employmentIndex[1]) };
  let node = element?.parentElement, depth = 0;
  while (node && depth < MAX_ANCESTORS) {
    if (String(node.tagName || "").toLowerCase() === "form" || (node.querySelectorAll?.("input,select,textarea")?.length || 0) > FORM_SIZED) break;
    const attributes = attributeText(node), heading = headingText(node);
    const text = `${attributes} ${heading}`;
    const educationMatch = text.match(INDEXED_EDUCATION), employmentMatch = text.match(INDEXED_EMPLOYMENT);
    if (educationMatch) return { kind: "education", index: Number(educationMatch[1]) };
    if (employmentMatch) return { kind: "employment", index: Number(employmentMatch[1]) };
    if (EDUCATION_ATTRIBUTE.test(attributes) || EDUCATION_HEADING.test(heading)) return { kind: "education", index: null };
    if (EMPLOYMENT_ATTRIBUTE.test(attributes) || EMPLOYMENT_HEADING.test(heading)) return { kind: "employment", index: null };
    node = node.parentElement;
    depth += 1;
  }
  return { kind: null, index: null };
}

// Visible question for a control, including React Select wrappers and fieldset legends.
export function questionText(element) {
  const labels = [...(element?.labels || [])].map((label) => clean(label.textContent));
  const wrapping = clean(element?.closest?.("label")?.textContent);
  const legend = clean(element?.closest?.("fieldset")?.querySelector?.("legend")?.textContent);
  const previous = clean(element?.previousElementSibling?.textContent);
  const parentLabel = clean(element?.parentElement?.querySelector?.("label")?.textContent);
  const prompt = clean(element?.parentElement?.querySelector?.("[data-ui='label'],[class*='label'],[class*='Label'],[class*='question'],[class*='Question']")?.textContent);
  const wrapper = element?.closest?.(".field-wrapper,.select,[class*='field-wrapper'],[class*='question']");
  const wrapperPrompt = clean(wrapper?.querySelector?.("label,legend,[class*='label'],[class*='Label']")?.textContent);
  const labelledBy = clean(element?.getAttribute?.("aria-labelledby")).split(" ").filter(Boolean)
    .map((id) => clean(element?.ownerDocument?.getElementById?.(id)?.textContent));
  const aria = clean(element?.getAttribute?.("aria-label"));
  return [...new Set([legend, ...labels, wrapping, previous, parentLabel, prompt, wrapperPrompt, ...labelledBy, aria].filter(Boolean))].join(" ").slice(0, 600);
}

export function wordCount(value) { return clean(value).split(" ").filter(Boolean).length; }

// A label written as a sentence or question ("I hereby state…", "Are you open to travel for company
// events…") must not be read as a one-word contact field such as State or Company.
export function sentenceLike(value) {
  const text = clean(value);
  return wordCount(text) > 8 || (/\?/.test(text) && wordCount(text) > 4);
}
