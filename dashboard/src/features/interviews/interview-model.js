export const INTERVIEW_STAGES = Object.freeze([
  ["RECRUITER", "Recruiter"],
  ["HIRING_MANAGER", "Hiring Manager"],
  ["TECH", "Tech"],
  ["FINAL", "Final"],
]);

export const INTERVIEW_STATUSES = Object.freeze([
  ["UPCOMING", "Upcoming"],
  ["COMPLETED", "Completed"],
  ["REJECTED", "Rejected"],
  ["NOT_JOINED", "Not Joined"],
  ["RESCHEDULED", "Rescheduled"],
  ["NEEDS_FOLLOW_UP", "Needs Follow Up"],
]);

export const INTERVIEW_TYPES = Object.freeze([
  ["TEAMS", "Microsoft Teams"],
  ["GOOGLE_MEET", "Google Meet"],
  ["ZOOM", "Zoom"],
  ["VIDEO", "Video Call"],
  ["PHONE", "Phone"],
  ["AI_INTERVIEW", "AI Interview"],
]);

export const JOB_TYPES = Object.freeze([
  ["FULL_TIME", "Full-Time"],
  ["PART_TIME", "Part-Time"],
  ["CONTRACT", "Contract"],
]);

export const INTERVIEW_LOCATIONS = Object.freeze([
  ["REMOTE", "Remote"],
  ["ONSITE", "On-Site"],
  ["HYBRID", "Hybrid"],
]);

export const ROUND_STATUSES = Object.freeze([
  ["", "Not set"],
  ["PASSED", "Passed"],
  ["UPCOMING", "Upcoming"],
  ["FAILED", "Failed"],
]);

export const STAGE_COLOR = Object.freeze({
  RECRUITER: "#722ed1",
  HIRING_MANAGER: "#eb2f96",
  TECH: "#1677ff",
  FINAL: "#d48806",
});

export const CATEGORY_EVENT_COLORS = Object.freeze({
  "software-engineering": { background: "#bae0ff", color: "#003eb3" },
  "data-engineering": { background: "#efdbbf", color: "#613400" },
  "business-intelligence-analytics": { background: "#efdbbf", color: "#613400" },
  "ai-machine-learning": { background: "#fff1b8", color: "#614700" },
  "cloud-devops-reliability": { background: "#d9d9d9", color: "#1f1f1f" },
});

export function interviewEventColor(categorySlug) {
  return CATEGORY_EVENT_COLORS[categorySlug] || { background: "#8c8c8c", color: "#ffffff" };
}

export const STANDARD_ROUNDS = Object.freeze([
  "Recruiter Screen",
  "Hiring Manager",
  "Technical Interview",
  "System Design",
  "Final Round",
]);

export const GRID_START_MINUTES = 0;
export const GRID_END_MINUTES = 24 * 60;
export const HOUR_HEIGHT = 72;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINK = /^https?:\/\/\S+$/i;

const pad = (value) => String(value).padStart(2, "0");

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function startOfWeek(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

export function visibleRange(view, cursor) {
  if (view === "day") {
    const from = startOfDay(cursor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "month") {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const from = startOfWeek(first);
    return { from, to: addDays(from, 42) };
  }
  const from = startOfWeek(cursor);
  return { from, to: addDays(from, 7) };
}

export function shiftCursor(view, cursor, direction) {
  const date = new Date(cursor);
  if (view === "month") date.setMonth(date.getMonth() + direction);
  else if (view === "week") date.setDate(date.getDate() + direction * 7);
  else date.setDate(date.getDate() + direction);
  return date;
}

export function fetchWindow(view, cursor, now = new Date()) {
  const visible = visibleRange(view, cursor);
  const week = visibleRange("week", now);
  const horizon = { from: week.from, to: addDays(startOfDay(now), 31) };
  const from = new Date(Math.min(visible.from.getTime(), horizon.from.getTime()));
  const to = new Date(Math.max(visible.to.getTime(), horizon.to.getTime()));
  const span = to.getTime() - from.getTime();
  if (span <= 110 * 24 * 60 * 60 * 1000) return { from, to, visible, extra: null };
  return { from: visible.from, to: visible.to, visible, extra: horizon };
}

export function formatRangeLabel(view, cursor) {
  const { from, to } = visibleRange(view, cursor);
  const end = new Date(to.getTime() - 1);
  if (view === "day") {
    return from.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (view === "month") return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const startText = from.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const endText = end.toLocaleDateString(undefined, {
    month: from.getMonth() === end.getMonth() && from.getFullYear() === end.getFullYear() ? undefined : "long",
    day: "numeric",
    year: "numeric",
  });
  return `${startText} – ${endText}`;
}

export function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function defaultStart(now = new Date()) {
  const date = new Date(now);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

export function blankRound(roundName = "") {
  return { roundName, startsAt: "", endsAt: "", interviewer: "", status: "", notes: "" };
}

export function blankInterviewForm(now = new Date()) {
  const start = defaultStart(now);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    applicationId: "",
    applicationNumber: "",
    intervieweeUserId: "",
    startsAt: toDateTimeLocal(start),
    endsAt: toDateTimeLocal(end),
    intervieweeName: "",
    profileName: "",
    profileEmail: "",
    profilePhone: "",
    professionalStack: "",
    companyName: "",
    companyWebsite: "",
    jobLink: "",
    roleTitle: "",
    jobType: "",
    location: "",
    salaryRange: "",
    stage: "RECRUITER",
    status: "UPCOMING",
    interviewType: "TEAMS",
    meetingUrl: "",
    meetingId: "",
    passcode: "",
    recruiterName: "",
    recruiterEmail: "",
    recruiterPhone: "",
    interviewers: "",
    interviewerPosition: "",
    interviewerLocation: "",
    linkedinUrl: "",
    resumeLink: "",
    place: "",
    appliedDate: "",
    notes: "",
    detailedInformation: "",
    rounds: [],
  };
}

function text(value) {
  return value == null ? "" : String(value);
}

export function formatProfilePhone(value) {
  const raw = text(value).trim();
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

function choice(value, allowed) {
  const code = text(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return allowed.includes(code) ? code : "";
}

function crmResumeUrl(resumeId) {
  const id = text(resumeId).trim();
  if (!id || typeof location === "undefined" || !location.origin) return "";
  const path = location.pathname || "/";
  return `${location.origin}${path}#/resumes/${id}`;
}

export function interviewFormFromRecord(record) {
  const form = blankInterviewForm();
  if (!record) return form;
  return {
    ...form,
    applicationId: text(record.applicationId),
    applicationNumber: text(record.applicationNumber),
    intervieweeUserId: text(record.intervieweeUserId),
    startsAt: toDateTimeLocal(record.startsAt),
    endsAt: toDateTimeLocal(record.endsAt),
    intervieweeName: text(record.intervieweeName),
    profileName: text(record.profileName),
    profileEmail: text(record.profileEmail),
    profilePhone: formatProfilePhone(record.profilePhone),
    professionalStack: text(record.professionalStack),
    companyName: text(record.companyName),
    companyWebsite: text(record.companyWebsite),
    jobLink: text(record.jobLink),
    roleTitle: text(record.roleTitle),
    jobType: choice(record.jobType, JOB_TYPES.map(([code]) => code)),
    location: choice(record.location, INTERVIEW_LOCATIONS.map(([code]) => code)) || choice(record.jobType, INTERVIEW_LOCATIONS.map(([code]) => code)),
    salaryRange: text(record.salaryRange),
    stage: text(record.stage) || "RECRUITER",
    status: text(record.status) || "UPCOMING",
    interviewType: text(record.interviewType) === "OTHER" ? "VIDEO" : (text(record.interviewType) || "TEAMS"),
    meetingUrl: text(record.meetingUrl),
    meetingId: text(record.meetingId),
    passcode: text(record.passcode),
    recruiterName: text(record.recruiterName),
    recruiterEmail: text(record.recruiterEmail),
    recruiterPhone: text(record.recruiterPhone),
    interviewers: text(record.interviewers),
    interviewerPosition: text(record.interviewerPosition),
    interviewerLocation: text(record.interviewerLocation),
    linkedinUrl: text(record.linkedinUrl),
    resumeLink: text(record.resumeLink),
    place: text(record.place),
    appliedDate: text(record.appliedDate).slice(0, 10),
    notes: text(record.notes),
    detailedInformation: text(record.detailedInformation),
    rounds: Array.isArray(record.rounds)
      ? record.rounds.map((round) => ({
          roundName: text(round.roundName),
          startsAt: toDateTimeLocal(round.startsAt),
          endsAt: toDateTimeLocal(round.endsAt),
          interviewer: text(round.interviewer),
          status: text(round.status),
          notes: text(round.notes),
        }))
      : [],
  };
}

export function interviewFormFromDefaults(defaults) {
  return {
    ...blankInterviewForm(),
    applicationId: text(defaults?.applicationId),
    applicationNumber: text(defaults?.applicationNumber),
    intervieweeUserId: text(defaults?.intervieweeUserId),
    intervieweeName: text(defaults?.intervieweeName),
    profileName: text(defaults?.profileName) || text(defaults?.intervieweeName),
    profileEmail: text(defaults?.profileEmail),
    profilePhone: formatProfilePhone(defaults?.profilePhone),
    companyName: text(defaults?.companyName),
    jobLink: text(defaults?.jobLink),
    roleTitle: text(defaults?.roleTitle),
    jobType: choice(defaults?.jobType, JOB_TYPES.map(([code]) => code)),
    location: choice(defaults?.location, INTERVIEW_LOCATIONS.map(([code]) => code)),
    salaryRange: text(defaults?.salaryRange),
    appliedDate: text(defaults?.appliedDate).slice(0, 10),
    companyWebsite: text(defaults?.companyWebsite),
    linkedinUrl: text(defaults?.linkedinUrl),
    resumeLink: text(defaults?.resumeLink) || crmResumeUrl(defaults?.resumeId),
    place: text(defaults?.place),
  };
}

function optionalLink(value, label, errors) {
  const link = String(value || "").trim();
  if (link && !LINK.test(link)) errors.push(`${label} must start with http:// or https://.`);
  return link || undefined;
}

export function interviewPayload(values, { manager = false, id } = {}) {
  const errors = [];
  const intervieweeUserId = String(values?.intervieweeUserId || "").trim();
  const intervieweeName = String(values?.intervieweeName || "").trim();
  const companyName = String(values?.companyName || "").trim();
  const applicationId = String(values?.applicationId || "").trim();
  const startsAt = fromDateTimeLocal(values?.startsAt);
  const endsAt = fromDateTimeLocal(values?.endsAt);
  if (intervieweeUserId && !UUID.test(intervieweeUserId)) errors.push("Select an interviewee.");
  if (!companyName || companyName.length > 200) errors.push("Enter the company name.");
  if (!startsAt || !endsAt) errors.push("Enter the interview start and end time.");
  else if (new Date(endsAt) <= new Date(startsAt)) errors.push("The interview must end after it starts.");
  else if (new Date(endsAt) - new Date(startsAt) > 24 * 60 * 60 * 1000) errors.push("An interview must last 24 hours or less.");
  if (applicationId && !UUID.test(applicationId)) errors.push("The Application id is not valid.");
  if (!manager && !applicationId) errors.push("Link this interview to an Application assigned to you.");
  const rounds = Array.isArray(values?.rounds) ? values.rounds : [];
  if (rounds.length > 8) errors.push("An interview can have at most 8 rounds.");
  const roundPayload = rounds.map((round) => {
    const roundName = String(round?.roundName || "").trim();
    const roundStart = fromDateTimeLocal(round?.startsAt);
    const roundEnd = fromDateTimeLocal(round?.endsAt);
    if (!roundName) errors.push("Each round needs a name.");
    if ((roundStart && !roundEnd) || (!roundStart && roundEnd)) errors.push("Enter both a start and an end time for each round.");
    else if (roundStart && roundEnd && new Date(roundEnd) <= new Date(roundStart)) errors.push("A round must end after it starts.");
    return {
      roundName,
      startsAt: roundStart || undefined,
      endsAt: roundEnd || undefined,
      interviewer: String(round?.interviewer || "").trim() || undefined,
      status: String(round?.status || ""),
      notes: String(round?.notes || "").trim() || undefined,
    };
  });
  const companyWebsite = optionalLink(values?.companyWebsite, "Company Website URL", errors);
  const jobLink = optionalLink(values?.jobLink, "Job Link", errors);
  const meetingUrl = optionalLink(values?.meetingUrl, "Meeting Link", errors);
  const linkedinUrl = optionalLink(values?.linkedinUrl, "Profile LinkedIn URL", errors);
  const resumeLink = optionalLink(values?.resumeLink, "Resume Link", errors);
  if (errors.length) return { ok: false, message: errors[0] };
  return {
    ok: true,
    body: {
      ...(id ? { id } : {}),
      applicationId: applicationId || undefined,
      ...(intervieweeUserId ? { intervieweeUserId } : {}),
      intervieweeName: intervieweeName || undefined,
      startsAt,
      endsAt,
      profileName: String(values.profileName || "").trim() || undefined,
      profileEmail: String(values.profileEmail || "").trim() || undefined,
      profilePhone: String(values.profilePhone || "").trim() || undefined,
      professionalStack: String(values.professionalStack || "").trim() || undefined,
      companyName,
      companyWebsite,
      jobLink,
      roleTitle: String(values.roleTitle || "").trim() || undefined,
      jobType: choice(values.jobType, JOB_TYPES.map(([code]) => code)) || undefined,
      location: choice(values.location, INTERVIEW_LOCATIONS.map(([code]) => code)) || undefined,
      salaryRange: String(values.salaryRange || "").trim() || undefined,
      stage: values.stage,
      status: values.status,
      interviewType: values.interviewType,
      meetingUrl,
      recruiterName: String(values.recruiterName || "").trim() || undefined,
      recruiterEmail: String(values.recruiterEmail || "").trim() || undefined,
      recruiterPhone: String(values.recruiterPhone || "").trim() || undefined,
      interviewers: String(values.interviewers || "").trim() || undefined,
      interviewerPosition: String(values.interviewerPosition || "").trim() || undefined,
      interviewerLocation: String(values.interviewerLocation || "").trim() || undefined,
      linkedinUrl,
      resumeLink,
      place: String(values.place || "").trim() || undefined,
      appliedDate: String(values.appliedDate || "").trim() || undefined,
      notes: String(values.notes || "").trim() || undefined,
      detailedInformation: String(values.detailedInformation || "").trim() || undefined,
      rounds: roundPayload,
    },
  };
}

export function interviewsInRange(items, range) {
  const from = range.from.getTime();
  const to = range.to.getTime();
  return (items || []).filter((item) => {
    const start = new Date(item.startsAt).getTime();
    return start >= from && start < to;
  });
}

export function summaryRange(view, cursor) {
  if (view === "month") {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    return { from, to: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) };
  }
  return visibleRange(view === "list" ? "week" : view, cursor);
}

export function summarizeInterviews(items, range, now = new Date()) {
  const ranged = interviewsInRange(items, range);
  const upcoming = ranged.filter((item) => new Date(item.startsAt) >= now && ["UPCOMING", "RESCHEDULED"].includes(item.status));
  return {
    total: ranged.length,
    upcoming: upcoming.length,
    completed: ranged.filter((item) => item.status === "COMPLETED").length,
    needsFollowUp: ranged.filter((item) => item.status === "NEEDS_FOLLOW_UP").length,
  };
}

export function upcomingInterviews(items, range, now = new Date()) {
  return interviewsInRange(items, range)
    .filter((item) => new Date(item.startsAt) >= now && !["COMPLETED", "REJECTED", "NOT_JOINED"].includes(item.status))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function sameDay(left, right) {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

export function layoutDayEvents(items, day) {
  const dayStart = startOfDay(day).getTime();
  const placed = [];
  const outside = [];
  for (const event of items || []) {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    if (end <= dayStart || start >= dayStart + 24 * 60 * 60 * 1000) continue;
    const startMin = (start - dayStart) / 60000;
    const endMin = (end - dayStart) / 60000;
    const topMin = Math.max(startMin, GRID_START_MINUTES);
    const bottomMin = Math.min(endMin, GRID_END_MINUTES);
    if (bottomMin <= GRID_START_MINUTES || topMin >= GRID_END_MINUTES) {
      outside.push(event);
      continue;
    }
    placed.push({
      event,
      start,
      end,
      top: ((topMin - GRID_START_MINUTES) / 60) * HOUR_HEIGHT,
      height: ((bottomMin - topMin) / 60) * HOUR_HEIGHT,
    });
  }
  placed.sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  let group = [];
  let groupEnd = -Infinity;
  for (const item of placed) {
    if (group.length && item.start >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -Infinity;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) groups.push(group);
  for (const cluster of groups) {
    const columns = [];
    for (const item of cluster) {
      let column = 0;
      while ((columns[column] || []).some((other) => other.start < item.end && item.start < other.end)) column += 1;
      if (!columns[column]) columns[column] = [];
      columns[column].push(item);
      item.column = column;
    }
    for (const item of cluster) {
      let span = 1;
      for (let column = item.column + 1; column < columns.length; column += 1) {
        if (columns[column].some((other) => other.start < item.end && item.start < other.end)) break;
        span += 1;
      }
      item.columnCount = columns.length;
      item.span = span;
    }
  }
  return { placed, outside };
}

export function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatWhen(startsAt, endsAt) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "Not scheduled";
  const date = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const end = formatClock(endsAt);
  return `${date}, ${formatClock(start)}${end ? ` – ${end}` : ""}`;
}

export function labelFor(pairs, value) {
  return pairs.find(([code]) => code === value)?.[1] || value || "—";
}
