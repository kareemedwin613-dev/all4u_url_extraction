type RecordValue = Record<string, any>;
const clean = (value: unknown) => String(value ?? "").trim();
const dateLine = /^(?:(?:0?[1-9]|1[0-2])\/)?(?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:(?:0?[1-9]|1[0-2])\/)?(?:19|20)\d{2}|present|current))?$/i;
export type EducationEntry = { item?: RecordValue; lines?: string[]; dateLabel?: string };

/** Display-only normalization. Never infer degrees or dates, or mutate source records. */
export function resumeEducationEntries(structured: RecordValue): EducationEntry[] {
  const items = Array.isArray(structured.education) ? structured.education : [];
  if (items.length) return items.map(item => ({item}));
  const legacy = clean(structured.education_legacy_text || (typeof structured.education === "string" ? structured.education : ""));
  if (!legacy) return [];
  const result: EducationEntry[] = [];
  for (const block of legacy.split(/\r?\n\s*\r?\n/)) {
    let lines: string[] = [];
    for (const line of block.split(/\r?\n/).map(clean).filter(Boolean)) {
      // A standalone year/range closes an entry; its exact text is retained.
      if (dateLine.test(line) && lines.length) { result.push({lines, dateLabel: line}); lines = []; }
      else lines.push(line);
    }
    if (lines.length) result.push({lines});
  }
  return result;
}
