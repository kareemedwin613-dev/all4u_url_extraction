import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fetchWindow,
  formatProfilePhone,
  interviewEventColor,
  interviewFormFromDefaults,
  interviewPayload,
  HOUR_HEIGHT,
  layoutDayEvents,
  startOfWeek,
  summarizeInterviews,
  summaryRange,
  upcomingInterviews,
  visibleRange,
} from "../src/features/interviews/interview-model.js";

const thursday = new Date(2026, 9, 1, 15, 30, 0);

test("calendar weeks start on Sunday and the fetch window covers this week plus upcoming days", () => {
  const week = visibleRange("week", thursday);
  assert.equal(week.from.getDay(), 0);
  assert.equal(week.from.getDate(), 27);
  assert.equal(week.from.getMonth(), 8);
  assert.equal(startOfWeek(thursday).getDate(), 27);
  const window = fetchWindow("day", thursday, thursday);
  assert.ok(window.from.getTime() <= week.from.getTime());
  assert.ok(window.to.getTime() >= week.to.getTime());
  assert.ok(window.to.getTime() - thursday.getTime() >= 30 * 24 * 60 * 60 * 1000);
});

test("interview payload requires a company and an application for appliers", () => {
  const missing = interviewPayload({
    intervieweeUserId: "f3a34ffd-d66a-49f7-815e-c7786857576b",
    intervieweeName: "Luke Lopez",
    startsAt: "2026-10-01T13:00",
    endsAt: "2026-10-01T14:00",
    stage: "TECH",
    status: "UPCOMING",
    interviewType: "TEAMS",
  }, { manager: true });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /company/i);
  const linked = interviewPayload({
    intervieweeUserId: "f3a34ffd-d66a-49f7-815e-c7786857576b",
    intervieweeName: "Luke Lopez",
    companyName: "Hansei Solutions",
    applicationId: "a3a34ffd-d66a-49f7-815e-c7786857576c",
    startsAt: "2026-10-01T13:00",
    endsAt: "2026-10-01T14:00",
    stage: "TECH",
    status: "UPCOMING",
    interviewType: "TEAMS",
    meetingUrl: "https://teams.microsoft.com/meet/example",
    rounds: [{ roundName: "Technical Interview", status: "UPCOMING" }],
  }, { manager: false });
  assert.equal(linked.ok, true);
  assert.equal(linked.body.companyName, "Hansei Solutions");
  assert.equal(linked.body.rounds[0].roundName, "Technical Interview");
  assert.equal(linked.body.id, undefined);
  const unlinked = interviewPayload({
    ...linked.body,
    startsAt: "2026-10-01T13:00",
    endsAt: "2026-10-01T14:00",
    applicationId: "",
  }, { manager: false });
  assert.equal(unlinked.ok, false);
});

test("a round time is a from and to range", () => {
  const base = {
    intervieweeUserId: "f3a34ffd-d66a-49f7-815e-c7786857576b",
    companyName: "Hansei Solutions",
    applicationId: "a3a34ffd-d66a-49f7-815e-c7786857576c",
    startsAt: "2026-10-01T13:00",
    endsAt: "2026-10-01T14:00",
    stage: "TECH",
    status: "UPCOMING",
    interviewType: "TEAMS",
  };
  const open = interviewPayload({
    ...base,
    rounds: [{ roundName: "Recruiter Screen", startsAt: "2026-10-01T13:00" }],
  }, { manager: false });
  assert.equal(open.ok, false);
  assert.match(open.message, /start and an end/i);
  const ranged = interviewPayload({
    ...base,
    rounds: [{ roundName: "Recruiter Screen", startsAt: "2026-10-01T13:00", endsAt: "2026-10-01T13:30" }],
  }, { manager: false });
  assert.equal(ranged.ok, true);
  assert.ok(ranged.body.rounds[0].endsAt > ranged.body.rounds[0].startsAt);
});

test("matched primary categories color the calendar event", () => {
  assert.equal(interviewEventColor("software-engineering").background, "#bae0ff");
  assert.equal(interviewEventColor("data-engineering").background, "#efdbbf");
  assert.equal(interviewEventColor("business-intelligence-analytics").background, "#efdbbf");
  assert.equal(interviewEventColor("ai-machine-learning").background, "#fff1b8");
  assert.equal(interviewEventColor("cloud-devops-reliability").background, "#d9d9d9");
  assert.equal(interviewEventColor("").background, "#8c8c8c");
});

test("autofilled profile phone numbers use a hyphen after the prefix", () => {
  assert.equal(formatProfilePhone("(239) 524 2228"), "(239) 524-2228");
  assert.equal(formatProfilePhone("2395242228"), "(239) 524-2228");
  assert.equal(interviewFormFromDefaults({ profilePhone: "(239) 524 2228" }).profilePhone, "(239) 524-2228");
});

test("application defaults fill LinkedIn, the resume page, and work location", () => {
  globalThis.location = { origin: "http://127.0.0.1:4174", pathname: "/" };
  const form = interviewFormFromDefaults({
    intervieweeName: "Freddy Criollo",
    applicationNumber: 65646,
    companyName: "Hansei Solutions",
    roleTitle: "Senior Analytics Engineer",
    location: "REMOTE",
    jobType: "REMOTE",
    place: "Austin, TX",
    linkedinUrl: "https://www.linkedin.com/in/example",
    resumeId: "b3a34ffd-d66a-49f7-815e-c7786857576d",
  });
  assert.equal(form.location, "REMOTE");
  assert.equal(form.jobType, "");
  assert.equal(form.place, "Austin, TX");
  assert.equal(form.profileName, "Freddy Criollo");
  assert.equal(form.applicationNumber, "65646");
  const carried = interviewFormFromDefaults({
    intervieweeUserId: "f3a34ffd-d66a-49f7-815e-c7786857576b",
    companyWebsite: "https://hansei.example",
    jobType: "FULL_TIME",
  });
  assert.equal(carried.intervieweeUserId, "f3a34ffd-d66a-49f7-815e-c7786857576b");
  assert.equal(carried.companyWebsite, "https://hansei.example");
  assert.equal(carried.jobType, "FULL_TIME");
  assert.equal(form.linkedinUrl, "https://www.linkedin.com/in/example");
  assert.equal(form.resumeLink, "http://127.0.0.1:4174/#/resumes/b3a34ffd-d66a-49f7-815e-c7786857576d");
});

test("event height follows duration and only overlapping meetings share the column", () => {
  const day = new Date(2026, 9, 1);
  const at = (hour, minute, duration) => {
    const start = new Date(2026, 9, 1, hour, minute, 0);
    return {
      id: `${hour}-${minute}-${duration}`,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + duration * 60000).toISOString(),
    };
  };
  const layout = layoutDayEvents([
    at(13, 0, 60),
    at(13, 0, 15),
    at(13, 0, 45),
    at(13, 0, 30),
    at(11, 0, 30),
  ], day);
  const byId = Object.fromEntries(layout.placed.map((item) => [item.event.id, item]));
  assert.equal(byId["13-0-15"].height, HOUR_HEIGHT / 4);
  assert.equal(byId["13-0-30"].height, HOUR_HEIGHT / 2);
  assert.equal(byId["13-0-45"].height, HOUR_HEIGHT * 0.75);
  assert.equal(byId["13-0-60"].height, HOUR_HEIGHT);
  assert.ok(byId["13-0-15"].height < byId["13-0-30"].height);
  assert.ok(byId["13-0-30"].height < byId["13-0-45"].height);
  assert.ok(byId["13-0-45"].height < byId["13-0-60"].height);
  const onePm = ["13-0-15", "13-0-30", "13-0-45", "13-0-60"].map((id) => byId[id]);
  assert.equal(new Set(onePm.map((item) => item.column)).size, 4);
  for (const item of onePm) {
    assert.equal(item.columnCount, 4);
    assert.equal(item.span, 1);
  }
  assert.equal(byId["11-0-30"].columnCount, 1);
  assert.equal(byId["11-0-30"].span, 1);
  assert.equal(byId["13-0-60"].top, 13 * HOUR_HEIGHT);
  const early = layoutDayEvents([at(3, 30, 30)], day);
  assert.equal(early.outside.length, 0);
  assert.equal(early.placed[0].top, 3.5 * HOUR_HEIGHT);
  assert.equal(early.placed[0].height, HOUR_HEIGHT / 2);
});

test("summary and the upcoming list follow the day, week, or month on screen", () => {
  const now = new Date(2026, 9, 1, 15, 30, 0);
  const at = (month, day, hour, status) => ({
    startsAt: new Date(2026, month, day, hour, 0).toISOString(),
    endsAt: new Date(2026, month, day, hour + 1, 0).toISOString(),
    status,
  });
  const items = [
    at(9, 1, 13, "UPCOMING"),
    at(9, 2, 10, "UPCOMING"),
    at(8, 30, 13, "COMPLETED"),
    at(9, 8, 13, "NEEDS_FOLLOW_UP"),
    at(9, 1, 11, "NEEDS_FOLLOW_UP"),
  ];
  const week = summarizeInterviews(items, summaryRange("week", now), now);
  assert.equal(week.total, 4);
  assert.equal(week.upcoming, 1);
  assert.equal(week.completed, 1);
  assert.equal(week.needsFollowUp, 1);
  assert.equal(upcomingInterviews(items, summaryRange("week", now), now).length, 1);
  const day = summarizeInterviews(items, summaryRange("day", now), now);
  assert.equal(day.total, 2);
  assert.equal(day.upcoming, 0);
  assert.equal(day.completed, 0);
  assert.equal(day.needsFollowUp, 1);
  const month = summarizeInterviews(items, summaryRange("month", now), now);
  assert.equal(month.total, 4);
  assert.equal(month.upcoming, 1);
  assert.equal(month.completed, 0);
  assert.equal(month.needsFollowUp, 2);
  assert.equal(summaryRange("month", now).from.getDate(), 1);
  assert.equal(summaryRange("month", now).to.getMonth(), 10);
});

test("saving Interview Scheduled opens the calendar for that application", async () => {
  const page = await readFile(new URL("../src/features/applications/application-pages.jsx", import.meta.url), "utf8");
  assert.match(page, /scheduleInterview/);
  assert.match(page, /#\/calendar\?application=\$\{id\}/);
  assert.match(page, /ApplicationInterviewsCard/);
});
