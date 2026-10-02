import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Dropdown,
  Flex,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
} from "antd";
import {
  BankOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  ContactsOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  IdcardOutlined,
  LeftOutlined,
  LinkOutlined,
  LockOutlined,
  NumberOutlined,
  ProfileOutlined,
  RightOutlined,
  TeamOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { CAPABILITIES, hasCapability } from "../../access/capabilities.js";
import { safeExternalUrl } from "../../shared/url.js";
import {
  GRID_END_MINUTES,
  GRID_START_MINUTES,
  HOUR_HEIGHT,
  INTERVIEW_STAGES,
  INTERVIEW_STATUSES,
  INTERVIEW_TYPES,
  interviewEventColor,
  formatProfilePhone,
  addDays,
  fetchWindow,
  formatClock,
  formatRangeLabel,
  formatWhen,
  interviewFormFromDefaults,
  interviewFormFromRecord,
  interviewPayload,
  interviewsInRange,
  labelFor,
  layoutDayEvents,
  sameDay,
  shiftCursor,
  startOfDay,
  visibleRange,
} from "./interview-model.js";
import { InterviewFormModal } from "./interview-form.jsx";
import { loadCategories } from "../../services/category-service.js";
import { listResumes } from "../../services/resume-read-service.js";
import {
  createInterview,
  deleteInterview,
  getInterview,
  interviewApplicationDefaults,
  listIntervieweeUsers,
  listInterviews,
  updateInterview,
} from "./interview-service.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_ORDER = ["software-engineering", "data-engineering", "business-intelligence-analytics", "ai-machine-learning", "cloud-devops-reliability"];

function categoryRank(slug) {
  const index = CATEGORY_ORDER.indexOf(slug);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

function resumeCategorySlugs(resume, categories) {
  const ids = [];
  for (const row of resume?.tech_stacks || []) {
    if (row?.primary_category_id && !ids.includes(row.primary_category_id)) ids.push(row.primary_category_id);
  }
  if (resume?.primary_category_id && !ids.includes(resume.primary_category_id)) ids.push(resume.primary_category_id);
  const slugs = [];
  for (const id of ids) {
    const slug = categories?.byId?.get(id)?.slug || "";
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  slugs.sort((left, right) => categoryRank(left) - categoryRank(right));
  return slugs.length ? slugs : [""];
}

function calendarCheck(ink) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='${ink}' d='M6.2 11.4 2.8 8l1.1-1.1 2.3 2.3 5-5.1 1.1 1.1z'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

async function loadActiveResumeAccounts(client, apiBaseUrl) {
  const categories = await loadCategories(client, apiBaseUrl);
  const byEmail = new Map();
  let page = 1;
  while (page <= 20) {
    const result = await listResumes(client, apiBaseUrl, { status: "ACTIVE", page, pageSize: 100, sort: "candidate_asc" });
    for (const item of result?.items || []) {
      const email = String(item.candidate_email || "").trim().toLowerCase();
      if (!email) continue;
      const slugs = byEmail.get(email) || new Set();
      for (const slug of resumeCategorySlugs(item, categories)) slugs.add(slug);
      byEmail.set(email, slugs);
    }
    if (!result?.hasNext) break;
    page += 1;
  }
  return [...byEmail.keys()].sort((left, right) => left.localeCompare(right)).map((email) => ({
    email,
    calendars: [...byEmail.get(email)].sort((left, right) => categoryRank(left) - categoryRank(right)).reduce((groups, slug) => {
      const colors = interviewEventColor(slug);
      const existing = groups.find((group) => group.background === colors.background);
      if (existing) existing.slugs.push(slug);
      else groups.push({ slugs: [slug], key: `${email}|${colors.background}`, ...colors });
      return groups;
    }, []),
  }));
}
const STATUS_COLOR = { UPCOMING: "green", COMPLETED: "default", REJECTED: "red", NOT_JOINED: "volcano", RESCHEDULED: "gold", NEEDS_FOLLOW_UP: "orange" };
const DETAIL_TYPE_LABEL = {
  TEAMS: "Microsoft Teams Meeting",
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom Meeting",
  VIDEO: "Video Call",
  PHONE: "Phone",
  AI_INTERVIEW: "AI Interview",
};

function detailSchedule(startsAt, endsAt) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { date: "Not scheduled", time: "" };
  const date = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const clock = (value) => new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(start).find((part) => part.type === "timeZoneName")?.value || "";
  const end = endsAt ? new Date(endsAt) : null;
  const endClock = end && !Number.isNaN(end.getTime()) ? clock(end) : "";
  return { date, time: `${clock(start)}${endClock ? ` – ${endClock}` : ""}${zone ? ` (${zone})` : ""}` };
}

function DetailRow({ icon, label, children }) {
  if (children == null || children === false || children === "") return null;
  return (
    <div className="interview-detail-row">
      <span className="interview-detail-icon" aria-hidden="true">{icon}</span>
      <span className="interview-detail-label">{label}</span>
      <div className="interview-detail-value">{children}</div>
    </div>
  );
}

function InterviewDetails({ interview, meetingUrl, canRecord, busy, onEdit, onStatus, onDelete }) {
  const schedule = detailSchedule(interview.startsAt, interview.endsAt);
  const status = labelFor(INTERVIEW_STATUSES, interview.status);
  const statusClass = `interview-status-pill is-${String(interview.status || "upcoming").toLowerCase().replace(/_/g, "-")}`;
  const notes = String(interview.detailedInformation || interview.notes || "").trim();
  const recruiterPhone = formatProfilePhone(interview.recruiterPhone);
  const recruiterEmail = String(interview.recruiterEmail || "").trim();
  const interviewerExtra = [interview.interviewerPosition, interview.interviewerLocation].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  const statusControl = canRecord ? (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: INTERVIEW_STATUSES.map(([value, label]) => ({ key: value, label })),
        onClick: ({ key }) => onStatus(key),
      }}
    >
      <button type="button" className={statusClass} disabled={busy}>
        {status} <DownOutlined />
      </button>
    </Dropdown>
  ) : <span className={statusClass}>{status}</span>;
  return (
    <div className="interview-details">
      {canRecord ? (
        <div className="interview-details-toolbar">
          <Button icon={<EditOutlined />} onClick={onEdit}>Edit</Button>
        </div>
      ) : null}
      <div className="interview-details-heading">
        <h3>{interview.profileName || interview.intervieweeName || "Interview"}</h3>
        {statusControl}
      </div>
      <div className="interview-detail-list">
        <DetailRow icon={<CalendarOutlined />} label="Date & Time">
          <div>{schedule.date}</div>
          {schedule.time ? <div>{schedule.time}</div> : null}
        </DetailRow>
        <DetailRow icon={<UserOutlined />} label="Interviewee">{interview.intervieweeName}</DetailRow>
        <DetailRow icon={<BankOutlined />} label="Company">{interview.companyName}</DetailRow>
        <DetailRow icon={<IdcardOutlined />} label="Role">{interview.roleTitle}</DetailRow>
        <DetailRow icon={<ClockCircleOutlined />} label="Stage">{labelFor(INTERVIEW_STAGES, interview.stage)}</DetailRow>
        <DetailRow icon={<VideoCameraOutlined />} label="Interview Type">{DETAIL_TYPE_LABEL[interview.interviewType] || labelFor(INTERVIEW_TYPES, interview.interviewType)}</DetailRow>
        {meetingUrl ? (
          <DetailRow icon={<LinkOutlined />} label="Meeting Link">
            <a href={meetingUrl} target="_blank" rel="noopener noreferrer"><LinkOutlined /> Join Meeting</a>
          </DetailRow>
        ) : null}
        <DetailRow icon={<NumberOutlined />} label="Meeting ID">{interview.meetingId}</DetailRow>
        <DetailRow icon={<LockOutlined />} label="Passcode">{interview.passcode}</DetailRow>
        {interview.recruiterName || recruiterEmail || recruiterPhone ? (
          <DetailRow icon={<ContactsOutlined />} label="Recruiter">
            {interview.recruiterName ? <div>{interview.recruiterName}</div> : null}
            {recruiterEmail ? <div><a href={`mailto:${recruiterEmail}`}>{recruiterEmail}</a></div> : null}
            {recruiterPhone ? <div>{recruiterPhone}</div> : null}
          </DetailRow>
        ) : null}
        {interview.interviewers ? (
          <DetailRow icon={<TeamOutlined />} label="Interviewers">
            <div>{interview.interviewers}</div>
            {interviewerExtra ? <div className="interview-detail-muted">{interviewerExtra}</div> : null}
          </DetailRow>
        ) : null}
        {interview.applicationId ? (
          <DetailRow icon={<ProfileOutlined />} label="Application">
            <a href={`#/applications/${interview.applicationId}`}>Application{interview.applicationNumber ? ` #${interview.applicationNumber}` : ""}</a>
          </DetailRow>
        ) : null}
        {notes ? (
          <DetailRow icon={<FileTextOutlined />} label="Notes">
            <div className="interview-notes">{notes}</div>
          </DetailRow>
        ) : null}
      </div>
      {canRecord ? (
        <div className="interview-details-actions">
          <Popconfirm title="Delete this interview?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={onDelete}>
            <Button type="text" danger loading={busy}>Delete</Button>
          </Popconfirm>
        </div>
      ) : null}
    </div>
  );
}

function EventButton({ event, style, compact, onSelect }) {
  return (
    <button
      type="button"
      className={compact ? "calendar-event is-compact" : "calendar-event"}
      style={{ ...interviewEventColor(event.categorySlug), ...style }}
      onClick={() => onSelect(event)}
    >
      <strong>{event.companyName}</strong>
      {compact ? null : <small>{formatClock(event.startsAt)} · {event.intervieweeName || event.profileName}</small>}
    </button>
  );
}

function TimeGrid({ days, items, onSelect }) {
  const hours = [];
  for (let minute = GRID_START_MINUTES; minute < GRID_END_MINUTES; minute += 60) {
    const hour = Math.floor(minute / 60);
    hours.push(new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" }));
  }
  const today = new Date();
  const layouts = days.map((day) => layoutDayEvents(items, day));
  const hasOutside = layouts.some((layout) => layout.outside.length > 0);
  return (
    <div className={days.length === 1 ? "calendar-grid calendar-grid-day" : "calendar-grid"}>
      <div className="calendar-grid-head" />
      {days.map((day) => (
        <div key={day.toISOString()} className={sameDay(day, today) ? "calendar-day-head is-today" : "calendar-day-head"}>
          {WEEKDAYS[day.getDay()]}
          <strong>{day.getDate()}</strong>
        </div>
      ))}
      {hasOutside ? <div className="calendar-gutter" /> : null}
      {hasOutside ? layouts.map((layout, index) => (
        <div key={`out-${days[index].toISOString()}`} className="calendar-outside">
          {layout.outside.map((event) => (
            <button key={event.id} type="button" style={interviewEventColor(event.categorySlug)} onClick={() => onSelect(event)}>
              {formatClock(event.startsAt)} {event.companyName}
            </button>
          ))}
        </div>
      )) : null}
      <div className="calendar-hours" style={{ height: ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * HOUR_HEIGHT }}>
        {hours.map((label, index) => (
          <div key={index} className="calendar-hour" style={{ height: HOUR_HEIGHT }}>{label}</div>
        ))}
      </div>
      {layouts.map((layout, index) => {
        const day = days[index];
        return (
          <div key={`col-${day.toISOString()}`} className="calendar-day-column" style={{ height: ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * HOUR_HEIGHT, "--hour-height": `${HOUR_HEIGHT}px` }}>
            {layout.placed.map((item) => (
              <EventButton
                key={item.event.id}
                event={item.event}
                onSelect={onSelect}
                compact={item.height < HOUR_HEIGHT / 2}
                style={{
                  top: item.top,
                  height: Math.max(item.height - 3, 10),
                  left: `calc(${(item.column / item.columnCount) * 100}% + 1px)`,
                  width: `calc(${(item.span / item.columnCount) * 100}% - 3px)`,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function miniSelection(view, cursor, day) {
  if (view === "day") {
    const selected = sameDay(day, cursor);
    return { selected, start: selected, end: selected };
  }
  if (view === "month") {
    const selected = day.getFullYear() === cursor.getFullYear() && day.getMonth() === cursor.getMonth();
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return {
      selected,
      start: selected && (day.getDay() === 0 || day.getDate() === 1),
      end: selected && (day.getDay() === 6 || day.getDate() === last),
    };
  }
  const week = visibleRange("week", cursor);
  const time = startOfDay(day).getTime();
  const selected = time >= week.from.getTime() && time < week.to.getTime();
  return { selected, start: selected && day.getDay() === 0, end: selected && day.getDay() === 6 };
}

function MiniMonth({ cursor, view, onSelect, accounts, enabledAccounts, onToggleAccount, onSelectAll, onUnselectAll }) {
  const [shown, setShown] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const cursorMonth = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  useEffect(() => {
    setShown(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  }, [cursorMonth, cursor]);
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const gridStart = addDays(startOfDay(first), -first.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const today = new Date();
  const title = shown.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <aside className="calendar-mini" aria-label={title}>
      <div className="calendar-mini-title">
        <button type="button" aria-label="Previous month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}>
          <LeftOutlined />
        </button>
        <strong>{title}</strong>
        <button type="button" aria-label="Next month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}>
          <RightOutlined />
        </button>
      </div>
      <div className="calendar-mini-grid">
        {WEEKDAYS.map((day) => <div key={day} className="calendar-mini-weekday">{day.slice(0, 1)}</div>)}
        {cells.map((day) => {
          const flags = miniSelection(view, cursor, day);
          const className = [
            "calendar-mini-day",
            day.getMonth() === shown.getMonth() ? "" : "is-outside",
            flags.selected ? "is-selected" : "",
            flags.start ? "is-range-start" : "",
            flags.end ? "is-range-end" : "",
            sameDay(day, today) ? "is-today" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={className}
              aria-label={day.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
              aria-pressed={flags.selected}
              onClick={() => onSelect(startOfDay(day))}
            >
              <span>{day.getDate()}</span>
            </button>
          );
        })}
      </div>
      {(accounts || []).length ? (
        <div className="calendar-account-actions">
          <button type="button" onClick={onSelectAll}>Select all</button>
          <button type="button" onClick={onUnselectAll}>Unselect all</button>
        </div>
      ) : null}
      <ul className="calendar-accounts">
        {(accounts || []).map((account) => (
          <li key={account.email}>
            <div className="calendar-account-email" title={account.email}>{account.email}</div>
            {account.calendars.map((calendar) => (
              <label key={calendar.key} className="calendar-account-row">
                <input
                  type="checkbox"
                  checked={(enabledAccounts || []).includes(calendar.key)}
                  aria-label={`${account.email} ${calendar.slugs.join(" ")} calendar`}
                  style={{
                    "--calendar-fill": calendar.background,
                    "--calendar-ink": calendar.color,
                    "--calendar-check": calendarCheck(calendar.color),
                  }}
                  onChange={() => onToggleAccount(calendar.key)}
                />
                <span>Calendar</span>
              </label>
            ))}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function MonthGrid({ cursor, items, onSelect }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const from = addDays(startOfDay(first), -first.getDay());
  const today = new Date();
  const cells = Array.from({ length: 42 }, (_, index) => addDays(from, index));
  return (
    <div className="calendar-month">
      {WEEKDAYS.map((day) => <div key={day} className="calendar-month-head">{day}</div>)}
      {cells.map((day) => {
        const events = (items || []).filter((item) => sameDay(item.startsAt, day));
        const outside = day.getMonth() !== cursor.getMonth();
        return (
          <div key={day.toISOString()} className={`calendar-month-cell${outside ? " is-outside" : ""}${sameDay(day, today) ? " is-today" : ""}`}>
            <div>{day.getDate()}</div>
            {events.slice(0, 3).map((event) => (
              <button key={event.id} type="button" className="calendar-month-event" style={interviewEventColor(event.categorySlug)} onClick={() => onSelect(event)}>
                {formatClock(event.startsAt)} {event.companyName}
              </button>
            ))}
            {events.length > 3 ? <div className="calendar-month-more">+{events.length - 3} more</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function CalendarPage({ client, apiBaseUrl, access, query = "" }) {
  const { message } = AntApp.useApp();
  const manager = hasCapability(access, CAPABILITIES.APPLICATION_MANAGE);
  const canRecord = hasCapability(access, CAPABILITIES.APPLICATION_VIEW);
  const canReadResumes = hasCapability(access, CAPABILITIES.BUSINESS_DATA_READ);
  const [interviewees, setInterviewees] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [view, setView] = useState("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [disabledAccounts, setDisabledAccounts] = useState([]);
  const enabledAccounts = useMemo(() => {
    const disabled = new Set(disabledAccounts);
    return accounts.flatMap((account) => account.calendars.map((calendar) => calendar.key)).filter((key) => !disabled.has(key));
  }, [accounts, disabledAccounts]);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState(null);
  const [editingId, setEditingId] = useState("");
  const openedQuery = useRef("");
  const range = useMemo(() => fetchWindow(view, cursor), [view, cursor]);
  const visibleItems = useMemo(() => {
    const inRange = interviewsInRange(items, range.visible);
    if (!accounts.length) return inRange;
    const enabled = new Set(enabledAccounts);
    const known = new Set(accounts.flatMap((account) => account.calendars.map((calendar) => calendar.key)));
    return inRange.filter((item) => {
      const email = String(item.profileEmail || "").trim().toLowerCase();
      const slug = String(item.categorySlug || "").trim();
      const key = `${email}|${interviewEventColor(slug).background}`;
      if (slug && known.has(key)) return enabled.has(key);
      const account = accounts.find((row) => row.email === email);
      return Boolean(account?.calendars.some((calendar) => enabled.has(calendar.key)));
    });
  }, [items, range, accounts, enabledAccounts]);

  const load = useCallback(async () => {
    setError("");
    try {
      const requests = [listInterviews(client, apiBaseUrl, { from: range.from, to: range.to })];
      if (range.extra) requests.push(listInterviews(client, apiBaseUrl, range.extra));
      const pages = await Promise.all(requests);
      const merged = new Map();
      for (const page of pages) {
        for (const item of page?.items || []) merged.set(item.id, item);
      }
      setItems([...merged.values()]);
    } catch (caught) {
      setItems([]);
      setError(caught.message || "Interviews could not be loaded.");
    }
  }, [client, apiBaseUrl, range.from, range.to, range.extra]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canReadResumes) return undefined;
    let active = true;
    loadActiveResumeAccounts(client, apiBaseUrl)
      .then((rows) => {
        if (!active) return;
        setAccounts(rows);
      })
      .catch(() => {
        if (active) setAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [canReadResumes, client, apiBaseUrl]);

  useEffect(() => {
    if (!canRecord) return undefined;
    let active = true;
    listIntervieweeUsers(client, apiBaseUrl)
      .then((rows) => {
        if (active) setInterviewees(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setInterviewees([]);
      });
    return () => {
      active = false;
    };
  }, [canRecord, client, apiBaseUrl]);

  useEffect(() => {
    if (!query) {
      openedQuery.current = "";
      return;
    }
    if (openedQuery.current === query) return;
    openedQuery.current = query;
    const params = new URLSearchParams(query);
    const applicationId = params.get("application") || "";
    const interviewId = params.get("interview") || "";
    if (applicationId) {
      setEditingId("");
      setFormInitial(null);
      setFormOpen(true);
      interviewApplicationDefaults(client, apiBaseUrl, applicationId)
        .then((defaults) => setFormInitial(interviewFormFromDefaults(defaults)))
        .catch((caught) => {
          setFormOpen(false);
          setError(caught.message || "The Application could not be prepared for an interview.");
        });
    }
    if (interviewId) {
      getInterview(client, apiBaseUrl, interviewId)
        .then(setSelected)
        .catch((caught) => setError(caught.message || "The interview could not be loaded."));
    }
    location.replace("#/calendar");
  }, [query, client, apiBaseUrl]);

  const days = view === "day"
    ? [startOfDay(cursor)]
    : Array.from({ length: 7 }, (_, index) => addDays(range.visible.from, index));

  async function save(values) {
    const payload = interviewPayload(
      { ...values, rounds: Array.isArray(values.rounds) ? values.rounds : (formInitial?.rounds || []) },
      { manager, id: editingId || undefined },
    );
    if (!payload.ok) {
      message.error(payload.message);
      return;
    }
    const body = { ...payload.body };
    delete body.id;
    setBusy(true);
    try {
      const saved = editingId
        ? await updateInterview(client, apiBaseUrl, editingId, body)
        : await createInterview(client, apiBaseUrl, body);
      setFormOpen(false);
      setSelected(saved);
      setError("");
      await load();
    } catch (caught) {
      setError(caught.message || "The interview could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(interview, status) {
    if (!interview || interview.status === status) return;
    const values = interviewFormFromRecord(interview);
    values.status = status;
    const payload = interviewPayload(values, { manager, id: interview.id });
    if (!payload.ok) {
      message.error(payload.message);
      return;
    }
    const body = { ...payload.body };
    delete body.id;
    setBusy(true);
    try {
      const saved = await updateInterview(client, apiBaseUrl, interview.id, body);
      setSelected(saved);
      setError("");
      await load();
    } catch (caught) {
      setError(caught.message || "The interview could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(interview) {
    setBusy(true);
    try {
      await deleteInterview(client, apiBaseUrl, interview.id);
      setSelected(null);
      setError("");
      await load();
    } catch (caught) {
      setError(caught.message || "The interview could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { title: "Date and time", dataIndex: "startsAt", render: (_, row) => formatWhen(row.startsAt, row.endsAt) },
    { title: "Interviewee", dataIndex: "intervieweeName", render: (_, row) => row.intervieweeName || row.profileName || "—" },
    { title: "Company", dataIndex: "companyName" },
    { title: "Role", dataIndex: "roleTitle", render: (value) => value || "—" },
    { title: "Stage", dataIndex: "stage", render: (value) => labelFor(INTERVIEW_STAGES, value) },
    { title: "Type", dataIndex: "interviewType", render: (value) => labelFor(INTERVIEW_TYPES, value) },
    { title: "Status", dataIndex: "status", render: (value) => <Tag color={STATUS_COLOR[value]}>{labelFor(INTERVIEW_STATUSES, value)}</Tag> },
  ];
  const meetingUrl = safeExternalUrl(selected?.meetingUrl);

  return (
    <div className="page calendar-page">
      {error ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} /> : null}
      <div className="calendar-body">
      <MiniMonth
        cursor={cursor}
        view={view}
        onSelect={setCursor}
        accounts={accounts}
        enabledAccounts={enabledAccounts}
        onToggleAccount={(key) => setDisabledAccounts((current) => (
          current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
        ))}
        onSelectAll={() => setDisabledAccounts([])}
        onUnselectAll={() => setDisabledAccounts(accounts.flatMap((account) => account.calendars.map((calendar) => calendar.key)))}
      />
      <div className="calendar-main">
      <Flex className="calendar-toolbar" justify="space-between" align="center" wrap gap={8}>
        <Space>
          <Button icon={<LeftOutlined />} aria-label="Previous" onClick={() => setCursor((current) => shiftCursor(view, current, -1))} />
          <Button onClick={() => setCursor(new Date())}>Today</Button>
          <Button icon={<RightOutlined />} aria-label="Next" onClick={() => setCursor((current) => shiftCursor(view, current, 1))} />
          <span className="calendar-range-label">{formatRangeLabel(view, cursor)}</span>
        </Space>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { label: "Day", value: "day" },
            { label: "Week", value: "week" },
            { label: "Month", value: "month" },
            { label: "List", value: "list" },
          ]}
        />
      </Flex>
      {items == null ? <Card loading /> : null}
      {items && (view === "week" || view === "day") ? <TimeGrid days={days} items={visibleItems} onSelect={setSelected} /> : null}
      {items && view === "month" ? <MonthGrid cursor={cursor} items={visibleItems} onSelect={setSelected} /> : null}
      {items && view === "list" ? (
        <Table rowKey="id" columns={columns} dataSource={visibleItems} pagination={false} onRow={(row) => ({ onClick: () => setSelected(row) })} />
      ) : null}
      </div>
      </div>
      <Drawer
        className="interview-details-drawer"
        title="Interview Details"
        open={Boolean(selected)}
        width={440}
        closable={{ placement: "end" }}
        onClose={() => setSelected(null)}
        styles={{ header: { borderBottom: "none" }, body: { paddingTop: 4 } }}
      >
        {selected ? <InterviewDetails interview={selected} meetingUrl={meetingUrl} canRecord={canRecord} busy={busy} onEdit={() => { setEditingId(selected.id); setFormInitial(interviewFormFromRecord(selected)); setFormOpen(true); setSelected(null); }} onStatus={(status) => updateStatus(selected, status)} onDelete={() => remove(selected)} /> : null}
      </Drawer>
      <InterviewFormModal
        open={formOpen}
        title={editingId ? "Edit interview" : "Add interview"}
        initial={formInitial}
        manager={manager}
        interviewees={interviewees}
        busy={busy}
        onCancel={() => setFormOpen(false)}
        onSubmit={save}
      />
    </div>
  );
}
