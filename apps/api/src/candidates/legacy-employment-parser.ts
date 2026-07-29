const MONTHS: Record<string, number> = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
const MONTH_NAME = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE_TOKEN = `(?:${MONTH_NAME}\\s+)?(?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(`\\b(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|Present|Current|Now)\\b`, "i");
const BULLET = /^\s*(?:[•●▪◦‣∙]|[-*])\s*/;
const clean = (value: unknown) => String(value || "").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();

function partialDate(value: string) {
  const match = clean(value).match(/^(?:([A-Za-z]+)\s+)?((?:19|20)\d{2})$/);
  if (!match) return null;
  const month = match[1] ? MONTHS[match[1].toLowerCase()] : null;
  return match[1] && !month ? null : { year: Number(match[2]), month };
}

function details(lines: string[]) {
  const result: string[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (BULLET.test(line)) result.push(`• ${line.replace(BULLET, "")}`);
    else if (result.length) result[result.length - 1] += ` ${line}`;
    else result.push(line);
  }
  return result.join("\n");
}

function titleAndLocation(value: string, initialLocation = "") {
  const line = clean(value);
  const match = line.match(/^(.*?)(?:\s{2,}|\s[-–—]\s)(Remote|Hybrid|On[- ]?site)$/i) || line.match(/^(.*?)\s+(Remote)$/i);
  return match ? { jobTitle: clean(match[1]), location: initialLocation || match[2] } : { jobTitle: line, location: initialLocation };
}

export function extractProfessionalExperienceSection(resumeText: string) {
  const text = clean(resumeText);
  const start = text.search(/^\s*(?:professional\s+)?experience(?:\s+history)?\s*:?[ \t]*$/im);
  if (start < 0) return "";
  const content = text.slice(start).replace(/^\s*(?:professional\s+)?experience(?:\s+history)?\s*:?[ \t]*\r?\n?/i, "");
  const end = content.search(/^\s*(?:education|skills?|technical skills|certifications?|projects?|awards?|references?)\s*:?[ \t]*$/im);
  return clean(end < 0 ? content : content.slice(0, end));
}

export function parseLegacyEmployment(value: string) {
  const lines = clean(value).split("\n").map(clean).filter(Boolean), markers: Array<{index:number;match:RegExpMatchArray;before:string;after:string}> = [];
  lines.forEach((line, index) => { const match = line.match(DATE_RANGE); if (match) markers.push({ index, match, before: clean(line.slice(0, match.index)), after: clean(line.slice((match.index || 0) + match[0].length)) }); });
  if (!markers.length) return [];
  return markers.map((marker, position) => {
    const next = markers[position + 1];
    const company = marker.before || clean(lines[marker.index - 1]);
    const start = marker.index + 1, end = next ? next.index - (next.before ? 0 : 1) : lines.length;
    const segment = lines.slice(start, Math.max(start, end));
    const titleIndex = segment.findIndex(line => !BULLET.test(line));
    const title = titleIndex >= 0 ? segment.splice(titleIndex, 1)[0] : "";
    let location = marker.after;
    if (!location && /^(remote|hybrid|on[- ]?site)$/i.test(segment[0] || "")) location = segment.shift() || "";
    const parsed = titleAndLocation(title, location), current = /^(present|current|now)$/i.test(marker.match[2]);
    return { id: crypto.randomUUID(), company, job_title: parsed.jobTitle, location: parsed.location, start_date: partialDate(marker.match[1]), end_date: current ? null : partialDate(marker.match[2]), is_current: current, experience_details: details(segment) };
  }).filter(item => item.company && item.job_title).slice(0, 50);
}
