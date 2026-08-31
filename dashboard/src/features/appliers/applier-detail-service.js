import { authenticatedApiRequest } from "../../services/api-client.js";
import { listActivityLog } from "../../services/activity-log-service.js";
import { normalizeApplierProductivity } from "../overview/applier-productivity.js";

const ACTIVITY_PAGE_SIZE = 25;

function normalizeAccessError(error, fallbackMessage) {
  const raw = String(error?.message || "");
  const upper = raw.toUpperCase();
  const code =
    upper.includes("APPLIER_NOT_FOUND")
      ? "APPLIER_NOT_FOUND"
      : upper.includes("ACCESS_DENIED") || error?.code === "42501"
        ? "ACCESS_DENIED"
        : error?.code || "UNKNOWN_ERROR";
  const messages = {
    APPLIER_NOT_FOUND: "This Applier was not found.",
    ACCESS_DENIED: "You do not have permission to view this Applier scorecard.",
  };
  return {
    code,
    message: messages[code] || raw || fallbackMessage,
    retryable: ["NETWORK_ERROR", "UNKNOWN_ERROR"].includes(code),
  };
}

async function getApplierScorecard(client, apiBaseUrl, applierId, dateRange) {
  const params = new URLSearchParams({
    from: dateRange.from,
    to: dateRange.to,
  });
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/admin/appliers/${encodeURIComponent(applierId)}/scorecard?${params}`,
  });
  return payload.data;
}

export async function loadApplierActivity(
  client,
  apiBaseUrl,
  applierId,
  dateRange,
  page = 1,
  pageSize = ACTIVITY_PAGE_SIZE,
) {
  return listActivityLog(client, apiBaseUrl, {
    from: dateRange.from,
    to: dateRange.to,
    applierId,
    page,
    pageSize,
  });
}

export async function loadApplierDetail(client, apiBaseUrl, applierId, dateRange) {
  try {
    const [scorecard, activityResult] = await Promise.all([
      getApplierScorecard(client, apiBaseUrl, applierId, dateRange),
      loadApplierActivity(client, apiBaseUrl, applierId, dateRange).catch(() => ({
        items: [],
        total: 0,
        page: 1,
        pageSize: ACTIVITY_PAGE_SIZE,
        totalPages: 0,
      })),
    ]);

    const rawRow = scorecard?.productivity;
    if (!rawRow?.id) {
      throw normalizeAccessError(
        { code: "APPLIER_NOT_FOUND", message: "This Applier was not found." },
        "This Applier was not found.",
      );
    }

    const productivity = normalizeApplierProductivity([rawRow], { dateRange })[0];

    return {
      productivity,
      rawRow,
      profileWorkload: scorecard?.profileWorkload || [],
      workloadSettings: scorecard?.workloadSettings || null,
      profiles: scorecard?.profiles || [],
      activity: activityResult?.items || [],
      activityTotal: activityResult?.total || 0,
      activityPage: activityResult?.page || 1,
      activityPageSize: activityResult?.pageSize || ACTIVITY_PAGE_SIZE,
    };
  } catch (error) {
    throw normalizeAccessError(error, "The Applier scorecard could not be loaded.");
  }
}
