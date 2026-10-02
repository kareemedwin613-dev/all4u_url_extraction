import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const CSV = process.argv[2];
const apply = process.argv.includes("--apply");
if (!CSV) {
  console.error("Usage: node scripts/import-notion-interviews.mjs <interviews.csv> [--apply]");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const STAGES = { Recruiter: "RECRUITER", HM: "HIRING_MANAGER", Tech: "TECH", Final: "FINAL", Offer: "FINAL", Onboarding: "FINAL", Rejected: "RECRUITER" };
const STATUSES = { Rejected: "REJECTED", Completed: "COMPLETED", Upcoming: "UPCOMING", Hired: "COMPLETED", Rescheduling: "RESCHEDULED", Cancelled: "NOT_JOINED" };
const TYPES = {
  "Microsoft Teams Meeting": "TEAMS",
  "Phone Call": "PHONE",
  "Google Meet": "GOOGLE_MEET",
  Zoom: "ZOOM",
  "Video Call": "VIDEO",
  "AI Interview": "AI_INTERVIEW",
};
const JOB_TYPES = { "Full-time": "FULL_TIME", "Part-time": "PART_TIME", Contract: "CONTRACT" };
const LOCATIONS = { Remote: "REMOTE", "On-Site": "ONSITE", Hybrid: "HYBRID" };
const TRACKING = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingid", "ref"]);
const LINK = /^https?:\/\/\S+$/i;

const pad = (value) => String(value).padStart(2, "0");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const clip = (value, max) => {
  const text = clean(value);
  return text ? text.slice(0, max) : null;
};
const linkOrNull = (value) => {
  const text = clean(value);
  return text && text.length <= 4000 && LINK.test(text) ? text : null;
};
function normalizeSourceUrl(value) {
  const text = linkOrNull(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const normalized = url.toString();
    return normalized.length <= 4000 ? normalized : null;
  } catch {
    return null;
  }
}
function formatPhone(value) {
  const raw = clean(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return clip(raw, 60);
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
function clock(time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  return `${pad(hour)}:${match[2]}:00`;
}
function stamp(year, month, day, time, zone) {
  const hour = clock(time);
  const offset = zone === "EDT" ? "-04:00" : "-05:00";
  return `${year}-${pad(month)}-${pad(day)}T${hour}${offset}`;
}
function yearFor(month) {
  return month === 11 || month === 12 ? 2025 : 2026;
}

function schedule(record) {
  const company = clean(record.Company);
  const profile = clean(record.Profile);
  const raw = clean(record["Interview Date"]);
  if (company === "Virtru" && profile === "Christopher Johnson" && raw.includes("Feb 3")) {
    return { startsAt: "2026-02-03T15:30:00-05:00", endsAt: "2026-02-03T16:30:00-05:00" };
  }
  const match = raw.match(/^([A-Z][a-z]{2}) (\d{1,2}) (\d{1,2}:\d{2} [AP]M) \((E[DS]T)\) → (\d{1,2}:\d{2} [AP]M)$/);
  if (!match || !MONTHS[match[1]]) return null;
  const month = MONTHS[match[1]];
  const year = yearFor(month);
  const startsAt = stamp(year, month, Number(match[2]), match[3], match[4]);
  const endsAt = stamp(year, month, Number(match[2]), match[5], match[4]);
  if (new Date(endsAt) <= new Date(startsAt) || new Date(endsAt) - new Date(startsAt) > 24 * 60 * 60 * 1000) return null;
  return { startsAt, endsAt };
}

const text = readFileSync(CSV, "utf8").replace(/^\uFEFF/, "");
const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
const headers = table[0];
const records = table.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
const seen = new Set();
const rows = [];
const problems = [];
for (const record of records) {
  const when = schedule(record);
  const company = clip(record.Company, 200);
  if (!when || !company) {
    problems.push([record.Company, record.Profile, record["Interview Date"]]);
    continue;
  }
  const profileEmail = clip(record["Profile Email"], 320);
  const profileName = clip(record.Profile, 200);
  const key = [company.toLowerCase(), (profileEmail || "").toLowerCase(), (profileName || "").toLowerCase(), when.startsAt].join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  const stage = STAGES[clean(record.Stage)] || "RECRUITER";
  const status = STATUSES[clean(record.Status)] || "COMPLETED";
  const interviewType = TYPES[clean(record["Interview Format"])] || "OTHER";
  const notes = clip(record["AI Assistance"] ? `AI Assistance: ${clean(record["AI Assistance"])}` : "", 10000);
  rows.push({
    importKey: key,
    ...when,
    profileName,
    profileEmail,
    profilePhone: formatPhone(record["Profile Phone Number"]),
    professionalStack: clip(record["Professional Stack"], 500),
    companyName: company,
    companyWebsite: linkOrNull(record["Company Website"]),
    jobLink: linkOrNull(record["Job Link"]),
    normalizedJobLink: normalizeSourceUrl(record["Job Link"]),
    roleTitle: clip(record.Role, 200),
    jobType: JOB_TYPES[clean(record["Job Type"])] || null,
    location: LOCATIONS[clean(record.Location)] || null,
    salaryRange: clip(record["Salary Range"], 200),
    stage,
    status,
    interviewType,
    meetingUrl: linkOrNull(record["Meeting URL"]),
    recruiterName: clip(record["HR Contact Name"], 200),
    recruiterEmail: clip(record["HR Contact Email"], 320),
    recruiterPhone: formatPhone(record["HR Contact Phone Number"]),
    interviewers: clip(record["Interviewer(s) Name"], 500),
    interviewerPosition: clip(record["Interviewer(s) Position"], 200),
    interviewerLocation: clip(record["Interviewer(s) Location"], 200),
    detailedInformation: clip(record["Detailed Information"], 4000),
    linkedinUrl: linkOrNull(record["LinkedIn URL"]),
    resumeLink: linkOrNull(record.Resume),
    notes,
  });
}

const august = new Date("2026-08-01T00:00:00-04:00").getTime();
const summary = {
  sourceRows: records.length,
  ready: rows.length,
  problems,
  beforeAugust: rows.filter((row) => new Date(row.startsAt).getTime() < august).length,
  fromAugust: rows.filter((row) => new Date(row.startsAt).getTime() >= august).length,
  withJobLink: rows.filter((row) => row.normalizedJobLink).length,
};
console.log(JSON.stringify(summary, null, 2));
if (!apply) process.exit(0);

const sqlText = (value) => (value == null || value === "" ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const columns = [
  "import_key", "starts_at", "ends_at", "profile_name", "profile_email", "profile_phone", "professional_stack",
  "company_name", "company_website", "job_link", "normalized_job_link", "role_title", "job_type", "location",
  "salary_range", "stage", "status", "interview_type", "meeting_url", "recruiter_name", "recruiter_email",
  "recruiter_phone", "interviewers", "interviewer_position", "interviewer_location", "detailed_information",
  "linkedin_url", "resume_link", "notes",
];
function values(row) {
  return [
    sqlText(row.importKey), `'${row.startsAt}'::timestamptz`, `'${row.endsAt}'::timestamptz`, sqlText(row.profileName),
    sqlText(row.profileEmail), sqlText(row.profilePhone), sqlText(row.professionalStack), sqlText(row.companyName),
    sqlText(row.companyWebsite), sqlText(row.jobLink), sqlText(row.normalizedJobLink), sqlText(row.roleTitle),
    sqlText(row.jobType), sqlText(row.location), sqlText(row.salaryRange), sqlText(row.stage), sqlText(row.status),
    sqlText(row.interviewType), sqlText(row.meetingUrl), sqlText(row.recruiterName), sqlText(row.recruiterEmail),
    sqlText(row.recruiterPhone), sqlText(row.interviewers), sqlText(row.interviewerPosition), sqlText(row.interviewerLocation),
    sqlText(row.detailedInformation), sqlText(row.linkedinUrl), sqlText(row.resumeLink), sqlText(row.notes),
  ].join(", ");
}

const dir = mkdtempSync(join(tmpdir(), "notion-import-"));
const setup = join(dir, "00-setup.sql");
writeFileSync(setup, `
create table if not exists public.notion_interview_import (
  import_key text primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  profile_name text,
  profile_email text,
  profile_phone text,
  professional_stack text,
  company_name text not null,
  company_website text,
  job_link text,
  normalized_job_link text,
  role_title text,
  job_type text,
  location text,
  salary_range text,
  stage text not null,
  status text not null,
  interview_type text not null,
  meeting_url text,
  recruiter_name text,
  recruiter_email text,
  recruiter_phone text,
  interviewers text,
  interviewer_position text,
  interviewer_location text,
  detailed_information text,
  linkedin_url text,
  resume_link text,
  notes text
);
truncate public.notion_interview_import;
`);

const files = [setup];
const batchSize = 40;
for (let index = 0; index < rows.length; index += batchSize) {
  const batch = rows.slice(index, index + batchSize);
  const file = join(dir, `batch-${String(index).padStart(4, "0")}.sql`);
  writeFileSync(file, `insert into public.notion_interview_import (${columns.join(", ")}) values\n${batch.map((row) => `(${values(row)})`).join(",\n")}\non conflict (import_key) do nothing;\n`);
  files.push(file);
}

const merge = join(dir, "99-merge.sql");
writeFileSync(merge, `
insert into public.interviews (
  application_id, interviewee_user_id, starts_at, ends_at, interviewee_name, profile_name, profile_email, profile_phone,
  professional_stack, company_name, company_website, job_link, role_title, job_type, location, salary_range, stage, status,
  interview_type, meeting_url, recruiter_name, recruiter_email, recruiter_phone, interviewers, interviewer_position,
  interviewer_location, detailed_information, linkedin_url, resume_link, notes, created_by
)
select
  match.application_id,
  null,
  s.starts_at,
  s.ends_at,
  null,
  s.profile_name,
  s.profile_email,
  s.profile_phone,
  s.professional_stack,
  s.company_name,
  s.company_website,
  s.job_link,
  s.role_title,
  s.job_type,
  s.location,
  s.salary_range,
  s.stage,
  s.status,
  s.interview_type,
  s.meeting_url,
  s.recruiter_name,
  s.recruiter_email,
  s.recruiter_phone,
  s.interviewers,
  s.interviewer_position,
  s.interviewer_location,
  s.detailed_information,
  s.linkedin_url,
  s.resume_link,
  s.notes,
  null
from public.notion_interview_import s
left join lateral (
  select min(a.id::text)::uuid as application_id
  from public.job_descriptions j
  join public.applications a on a.job_description_id = j.id
  where s.starts_at >= timestamptz '2026-08-01 00:00:00-04'
    and nullif(s.normalized_job_link, '') is not null
    and j.normalized_source_url = s.normalized_job_link
  having count(distinct a.id) = 1
) match on true
where not exists (
  select 1
  from public.interviews i
  where i.starts_at = s.starts_at
    and lower(i.company_name) = lower(s.company_name)
    and lower(coalesce(i.profile_email, '')) = lower(coalesce(s.profile_email, ''))
    and lower(coalesce(i.profile_name, '')) = lower(coalesce(s.profile_name, ''))
);

select jsonb_build_object(
  'staged', (select count(*) from public.notion_interview_import),
  'inserted', (
    select count(*)
    from public.interviews i
    join public.notion_interview_import s
      on i.starts_at = s.starts_at
     and lower(i.company_name) = lower(s.company_name)
     and lower(coalesce(i.profile_email, '')) = lower(coalesce(s.profile_email, ''))
     and lower(coalesce(i.profile_name, '')) = lower(coalesce(s.profile_name, ''))
     and i.interviewee_user_id is null
     and i.created_by is null
  ),
  'linked', (
    select count(*)
    from public.interviews i
    join public.notion_interview_import s
      on i.starts_at = s.starts_at
     and lower(i.company_name) = lower(s.company_name)
     and lower(coalesce(i.profile_email, '')) = lower(coalesce(s.profile_email, ''))
     and lower(coalesce(i.profile_name, '')) = lower(coalesce(s.profile_name, ''))
     and i.interviewee_user_id is null
    where i.application_id is not null
  )
) as import_result;

drop table public.notion_interview_import;
`);
files.push(merge);

function query(file) {
  const result = spawnSync(`npx supabase db query --linked --yes -f "${file}" --output-format json`, {
    cwd: "D:/1. Job Bid/all4u_url_extraction",
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Query failed for ${file}`);
  }
  return result.stdout;
}

const migration = "D:/1. Job Bid/all4u_url_extraction/supabase/migrations/202610011900_v3_146_interview_optional_interviewee.sql";
console.log(query(migration));
for (const file of files) {
  const output = query(file);
  if (file.endsWith("99-merge.sql")) console.log(output);
}
console.log(`Applied ${rows.length} prepared interviews from ${dir}`);
