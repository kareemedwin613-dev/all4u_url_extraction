// AI Autofill usage for the Overview card. The server sends hourly buckets; they are grouped here into the
// viewer's local days, so "Today" and "This Week" match the rest of the Overview.

const FIELDS = ["pages", "questionsAsked", "questionsFromTable", "modelCalls", "questionsSent", "draftedAnswers", "inputTokens", "outputTokens", "costMicroUsd"];
const DAY_MS = 86_400_000;
const pad = (value) => String(value).padStart(2, "0");
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "$0.0021" for small amounts, "$3.42" otherwise; "—" when unknown. */
export function formatUsd(microUsd) {
  if (microUsd === null || microUsd === undefined || !Number.isFinite(Number(microUsd))) return "—";
  const usd = Number(microUsd) / 1_000_000;
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function summarizeAiUsage(report, dateRange = null, now = new Date()) {
  if (!report || typeof report !== "object") return null;
  const hours = Array.isArray(report.hours) ? report.hours : [];
  const totals = Object.fromEntries(FIELDS.map((field) => [field, hours.reduce((total, hour) => total + (Number(hour?.[field]) || 0), 0)]));

  // Every local day of the period (up to 62), so quiet days show as zero in the chart.
  const byDay = new Map();
  const from = dateRange?.from ? new Date(dateRange.from) : null, to = dateRange?.to ? new Date(dateRange.to) : null;
  if (from && to && to > from && (to - from) / DAY_MS <= 62) {
    for (let day = new Date(from); day < to; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      byDay.set(localDay(day), { day: localDay(day), costMicroUsd: 0, questionsFromTable: 0, questionsSent: 0 });
    }
  }
  for (const hour of hours) {
    const at = new Date(hour?.hour);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDay(at), row = byDay.get(key) || { day: key, costMicroUsd: 0, questionsFromTable: 0, questionsSent: 0 };
    row.costMicroUsd += Number(hour.costMicroUsd) || 0;
    row.questionsFromTable += Number(hour.questionsFromTable) || 0;
    row.questionsSent += Number(hour.questionsSent) || 0;
    byDay.set(key, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));

  const applications = Number(report.autofilledApplications) || 0;
  const settings = report.settings || {};
  const capMicroUsd = Number.isFinite(Number(settings.monthlyCapUsd)) ? Number(settings.monthlyCapUsd) * 1_000_000 : null;
  const monthCost = Number(report.month?.costMicroUsd) || 0;
  // Month-end projection at the current pace, once at least one day of the month has passed.
  const start = Date.parse(report.month?.start), end = Date.parse(report.month?.end), elapsed = now.getTime() - start;
  const projected = Number.isFinite(start) && Number.isFinite(end) && end > start && elapsed >= DAY_MS
    ? Math.round((monthCost * (end - start)) / Math.min(elapsed, end - start))
    : null;

  return {
    totals,
    days,
    reuseRate: totals.questionsAsked ? Math.round((1000 * totals.questionsFromTable) / totals.questionsAsked) / 10 : null,
    applications,
    perApplicationMicroUsd: applications ? totals.costMicroUsd / applications : null,
    month: {
      costMicroUsd: monthCost,
      capMicroUsd,
      capShare: capMicroUsd ? Math.min(100, Math.round((1000 * monthCost) / capMicroUsd) / 10) : null,
      projectedMicroUsd: projected,
      projectedOverCap: projected !== null && capMicroUsd !== null && projected > capMicroUsd,
    },
    learnedWordings: Number(report.learnedWordings) || 0,
    status: !settings.enabled ? "OFF" : !settings.keyConfigured ? "NO_KEY" : "ON",
    model: settings.model || "",
    providerLabel: settings.providerLabel || "",
    remembersWordings: settings.remembersWordings !== false,
  };
}
