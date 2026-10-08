// The Applications the side panel is showing, shared with job pages so the on-page Autofill button can offer
// them by Application number. Only what the picker displays is kept: never Resume content or answers.

export const PANEL_APPLICATIONS_KEY = "panelApplications";
const MAX_ITEMS = 500, MAX_OTHERS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Job sites where the button is offered even before a matching Application is in the panel's list.
const ATS_HOSTS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "applytojob.com", "myworkdayjobs.com", "myworkdaysite.com",
  "smartrecruiters.com", "icims.com", "jobvite.com", "bamboohr.com", "recruitee.com", "breezy.hr", "jazzhr.com",
  "taleo.net", "successfactors.com", "rippling.com", "rippling-ats.com", "paylocity.com", "ultipro.com", "ukg.com",
  "dayforcehcm.com", "teamtailor.com", "pinpointhq.com", "personio.de", "personio.com", "trinethire.com", "workforcenow.adp.com",
];
const APPLY_SUFFIX = /\/(apply|application|apply-now|applynow|job-application)$/i;
const JOB_ID_PARAMS = ["gh_jid", "jid", "jobid", "job_id", "jobreqid", "id", "jr_id"];

const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function panelApplicationItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS).map((item) => ({
    id: String(item?.id || ""),
    number: Number(item?.application_number ?? item?.applicationNumber) || null,
    company: text(item?.company, 120),
    jobTitle: text(item?.job_title ?? item?.jobTitle, 160),
    candidate: text(item?.candidate_name ?? item?.candidateName, 120),
    status: text(item?.status, 30),
    urls: [item?.application_url, item?.applicationUrl, item?.source_url, item?.sourceUrl].filter((url) => typeof url === "string" && /^https?:\/\//i.test(url)).slice(0, 2).map((url) => url.slice(0, 2048)),
  })).filter((item) => UUID.test(item.id));
}

// host without "www.", path without a trailing apply step, and any job id from the query.
export function jobPageKey(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  while (APPLY_SUFFIX.test(path)) path = path.replace(APPLY_SUFFIX, "");
  const params = new Map([...parsed.searchParams].map(([key, value]) => [key.toLowerCase(), value]));
  const jobId = JOB_ID_PARAMS.map((key) => params.get(key)).find(Boolean) || "";
  return { host, path, segments: path.split("/").filter(Boolean), jobId };
}

// Same job: same host, same job id when both have one, and one path is the other or starts it
// (a posting and its /apply page). A bare company board ("/acme") never matches its job pages.
export function sameJobPage(a, b) {
  const left = jobPageKey(a), right = jobPageKey(b);
  if (!left || !right || left.host !== right.host) return false;
  if (left.jobId && right.jobId) return left.jobId === right.jobId;
  if (left.path === right.path) return Boolean(left.path || left.jobId || right.jobId);
  const [short, long] = left.segments.length <= right.segments.length ? [left, right] : [right, left];
  return short.segments.length >= 2 && short.segments.every((segment, index) => long.segments[index] === segment);
}

const hostOf = (url) => jobPageKey(url)?.host || "";
const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// The button is shown on job sites and on any site where one of the panel's Applications lives.
export function offerOnPage(url, items) {
  const host = hostOf(url);
  if (!host) return false;
  if (ATS_HOSTS.some((domain) => onHost(host, domain))) return true;
  return (items || []).some((item) => item.urls.some((itemUrl) => hostOf(itemUrl) === host));
}

const entry = (item) => ({ id: item.id, number: item.number, company: item.company, jobTitle: item.jobTitle, candidate: item.candidate });

export function pickerEntries(url, items) {
  const likely = [], others = [];
  for (const item of items || []) (item.urls.some((itemUrl) => sameJobPage(url, itemUrl)) ? likely : others).push(entry(item));
  return { likely, others: others.slice(0, MAX_OTHERS), total: (items || []).length };
}

export function isApplicationId(value) { return UUID.test(String(value || "")); }
