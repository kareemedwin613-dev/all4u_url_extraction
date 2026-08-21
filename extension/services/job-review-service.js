import { AppError } from "../shared/errors.js";
import { apiRequest } from "./api-client.js";

async function token(client) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new AppError("SESSION_EXPIRED", "Your session has expired. Sign in again.");
  return data.session.access_token;
}

async function call(client, baseUrl, path, options = {}) {
  return (await apiRequest({ baseUrl, path, token: await token(client), ...options })).data;
}

export async function listJobReviews(client, baseUrl, filters = {}) {
  const query = new URLSearchParams({ page: String(filters.page || 1), pageSize: "50", sort: "created_desc", status: "ALL" });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return call(client, baseUrl, `/api/v1/job-descriptions?${query}`);
}

export const listJobCapturers = (client, baseUrl) => call(client, baseUrl, "/api/v1/job-descriptions/capturers");
export const getJobReview = (client, baseUrl, id) => call(client, baseUrl, `/api/v1/job-descriptions/${encodeURIComponent(id)}`);

export const updateOwnJob = (client, baseUrl, id, correction) => call(
  client,
  baseUrl,
  `/api/v1/job-descriptions/${encodeURIComponent(id)}/correction`,
  { method: "PATCH", body: correction },
);

export const reviewJob = (client, baseUrl, id, decision) => call(
  client,
  baseUrl,
  `/api/v1/job-descriptions/${encodeURIComponent(id)}/review`,
  { method: "PATCH", body: decision },
);
