import { authenticatedApiRequest } from "../../services/api-client.js";

async function api(client, baseUrl, path, { method = "GET", body } = {}) {
  const { payload } = await authenticatedApiRequest(client, { baseUrl, path, method, body });
  return payload.data;
}

const query = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

export function listInterviews(client, baseUrl, { from, to, applicationId } = {}) {
  return api(client, baseUrl, `/api/v1/interviews${query({
    from: from ? new Date(from).toISOString() : "",
    to: to ? new Date(to).toISOString() : "",
    applicationId,
  })}`);
}

export const listIntervieweeUsers = (client, baseUrl) =>
  api(client, baseUrl, "/api/v1/interviews/interviewees");

export const interviewApplicationDefaults = (client, baseUrl, applicationId) =>
  api(client, baseUrl, `/api/v1/interviews/application-defaults/${encodeURIComponent(applicationId)}`);

export const getInterview = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/interviews/${encodeURIComponent(id)}`);

export const createInterview = (client, baseUrl, body) =>
  api(client, baseUrl, "/api/v1/interviews", { method: "POST", body });

export const updateInterview = (client, baseUrl, id, body) =>
  api(client, baseUrl, `/api/v1/interviews/${encodeURIComponent(id)}`, { method: "PATCH", body });

export const deleteInterview = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/interviews/${encodeURIComponent(id)}`, { method: "DELETE" });
