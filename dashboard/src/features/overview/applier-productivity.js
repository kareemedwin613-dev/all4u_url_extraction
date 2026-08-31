import { normalizeApplierPerformance } from "./applier-performance.js";

const count = (value) => Math.max(0, Number(value) || 0);

export const PRODUCTIVITY_STATUS = Object.freeze({
  ACTIVE: { key: "ACTIVE", label: "Active", color: "#52c41a" },
  LOW: { key: "LOW", label: "Low", color: "#faad14" },
  INACTIVE: { key: "INACTIVE", label: "Inactive", color: "#ff4d4f" },
});

export function overviewWindowDays(dateRange) {
  if (!dateRange?.from || !dateRange?.to) return 1;
  const days = Math.round(
    (new Date(dateRange.to).getTime() - new Date(dateRange.from).getTime()) /
      86400000,
  );
  return Math.max(1, days);
}

export function formatLastActivity(value, now = new Date()) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "No activity";
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / 86400000,
  );
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function activeDaysShare(activeDays, windowDays = 1) {
  const total = Math.max(1, Number(windowDays) || 1);
  return Math.round((Math.max(0, Number(activeDays) || 0) / total) * 1000) / 10;
}

export function avgPerDayTone(avgPerDay, windowDays = 1) {
  const value = Number(avgPerDay) || 0;
  const minAvg = windowDays <= 1 ? 1 : windowDays <= 7 ? 2 : 3;
  if (value >= minAvg) return "high";
  if (value >= minAvg * 0.5) return "medium";
  return "low";
}

export function formatLastActivityMeta(value, now = new Date()) {
  if (!value) {
    return { primary: "No activity", secondary: "—" };
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return { primary: "No activity", secondary: "—" };
  }
  const primary = formatLastActivity(value, now);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / 86400000,
  );
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (dayDiff === 0) {
    const diffMin = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
    if (diffMin < 1) return { primary, secondary: "Just now" };
    if (diffMin < 60) return { primary, secondary: `${diffMin}m ago` };
    return { primary, secondary: `${Math.floor(diffMin / 60)}h ago` };
  }
  if (dayDiff === 1) {
    return { primary, secondary: time };
  }
  return {
    primary,
    secondary: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
  };
}

export function deriveProductivityStatus(
  { profileStatus, lastActivityAt, applied, activeDays, avgPerDay },
  windowDays = 1,
) {
  if (profileStatus === "INACTIVE" || profileStatus === "PENDING") {
    return PRODUCTIVITY_STATUS.INACTIVE.key;
  }
  const daysSince = lastActivityAt
    ? (Date.now() - new Date(lastActivityAt).getTime()) / 86400000
    : Number.POSITIVE_INFINITY;
  if (daysSince > 3) return PRODUCTIVITY_STATUS.INACTIVE.key;
  if (applied === 0 && activeDays === 0) {
    return PRODUCTIVITY_STATUS.INACTIVE.key;
  }
  const minAvg = windowDays <= 1 ? 1 : windowDays <= 7 ? 2 : 3;
  if (avgPerDay >= minAvg || applied >= minAvg) {
    return PRODUCTIVITY_STATUS.ACTIVE.key;
  }
  return PRODUCTIVITY_STATUS.LOW.key;
}

export function computeProductivityScore(row) {
  const completion = Math.max(0, Math.min(100, Number(row.completionRate) || 0));
  const pace = Math.max(0, Math.min(100, (Number(row.avgPerDay) || 0) * 12));
  const statusScore =
    row.productivityStatus === PRODUCTIVITY_STATUS.ACTIVE.key
      ? 100
      : row.productivityStatus === PRODUCTIVITY_STATUS.LOW.key
        ? 58
        : 24;
  return Math.round(completion * 0.45 + pace * 0.3 + statusScore * 0.25);
}

export function gradeFromScore(score) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  if (value >= 80) {
    return { grade: "A", tone: "high", label: "Excellent" };
  }
  if (value >= 55) {
    return { grade: "B", tone: "medium", label: "On track" };
  }
  return { grade: "C", tone: "low", label: "Needs improvement" };
}

export function scoreTone(score) {
  return gradeFromScore(score).tone;
}

export function summarizeProductivityKpis(rows = [], options = {}) {
  const windowDays = Math.max(1, Number(options.windowDays) || 1);
  const total = rows.length;
  const active = rows.filter(
    (row) => row.productivityStatus === PRODUCTIVITY_STATUS.ACTIVE.key,
  ).length;
  const rowApplications = rows.reduce((sum, row) => sum + row.applied, 0);
  const applications =
    options.appliedTotal == null
      ? rowApplications
      : Math.max(0, Number(options.appliedTotal) || 0);
  const activeDays = rows.reduce((sum, row) => sum + row.activeDays, 0);
  const avgPerDay = activeDays
    ? Math.round((applications / activeDays) * 10) / 10
    : 0;
  const successRates = rows
    .map((row) => Number(row.completionRate) || 0)
    .filter((value) => value > 0);
  const avgSuccessRate = successRates.length
    ? Math.round(
        successRates.reduce((sum, value) => sum + value, 0) /
          successRates.length,
      )
    : 0;
  return {
    totalAppliers: total,
    activeAppliers: active,
    activeShare: total ? Math.round((active / total) * 1000) / 10 : 0,
    applications,
    avgPerDay,
    avgSuccessRate,
    windowDays,
  };
}

export function getNeedsAttentionAppliers(rows = [], limit = 4) {
  return [...rows]
    .filter(
      (row) =>
        row.productivityStatus === PRODUCTIVITY_STATUS.INACTIVE.key ||
        row.productivityStatus === PRODUCTIVITY_STATUS.LOW.key,
    )
    .sort((left, right) => {
      const rank = (row) =>
        row.productivityStatus === PRODUCTIVITY_STATUS.INACTIVE.key ? 0 : 1;
      const byRank = rank(left) - rank(right);
      if (byRank !== 0) return byRank;
      return (left.applied || 0) - (right.applied || 0);
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.productivityStatus,
      reason:
        row.productivityStatus === PRODUCTIVITY_STATUS.INACTIVE.key
          ? row.lastActivityAt
            ? `No activity since ${row.lastActivityLabel}`
            : "No activity in this period"
          : `Below target (${row.avgPerDay.toFixed(1)} avg/day)`,
    }));
}

export function getTopPerformers(rows = [], limit = 5) {
  return [...rows]
    .sort(
      (left, right) =>
        right.applied - left.applied ||
        right.score - left.score ||
        right.completionRate - left.completionRate,
    )
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      id: row.id,
      name: row.name,
      applied: row.applied,
      avgPerDay: row.avgPerDay,
      score: row.score,
    }));
}

export function buildActivityOverviewSegments(counts = {}) {
  const applied = count(counts.applied_today);
  const inProgress = count(counts.in_progress);
  const blocked = count(counts.blocked);
  const interviews = count(counts.interviews);
  const total = count(counts.total);
  const pending = Math.max(0, total - applied - inProgress - blocked - interviews);
  return [
    { key: "applied", label: "Applied", value: applied, color: "#52c41a" },
    { key: "in_progress", label: "In Progress", value: inProgress, color: "#1677ff" },
    { key: "blocked", label: "Blocked", value: blocked, color: "#fa8c16" },
    { key: "interviews", label: "Interviews", value: interviews, color: "#722ed1" },
    { key: "pending", label: "Pending", value: pending, color: "#8c8c8c" },
  ].filter((segment) => segment.value > 0);
}

export function normalizeApplierProductivity(rows = [], options = {}) {
  const windowDays = overviewWindowDays(options.dateRange);
  const baseRows = normalizeApplierPerformance(rows);
  return baseRows.map((row, index) => {
    const raw = (Array.isArray(rows) ? rows : [])[index] || {};
    const activeDays = count(raw.active_days);
    const avgPerDay = Math.max(0, Number(raw.avg_per_day) || 0);
    const lastActivityAt = raw.last_activity_at || null;
    const profileStatus = String(raw.profile_status || "ACTIVE").toUpperCase();
    const productivityStatus = deriveProductivityStatus(
      {
        profileStatus,
        lastActivityAt,
        applied: row.applied,
        activeDays,
        avgPerDay,
      },
      windowDays,
    );
    const enriched = {
      ...row,
      activeDays,
      avgPerDay,
      lastActivityAt,
      lastActivityLabel: formatLastActivity(lastActivityAt),
      profileStatus,
      productivityStatus,
      windowDays,
    };
    const score = computeProductivityScore(enriched);
    const gradeMeta = gradeFromScore(score);
    return {
      ...enriched,
      score,
      scoreTone: gradeMeta.tone,
      grade: gradeMeta.grade,
      gradeLabel: gradeMeta.label,
    };
  });
}
