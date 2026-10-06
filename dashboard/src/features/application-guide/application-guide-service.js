import { authenticatedApiRequest } from "../../services/api-client.js";

async function api(client, baseUrl, path, { method = "GET", body } = {}) {
  const { payload } = await authenticatedApiRequest(client, { baseUrl, path, method, body });
  return payload.data;
}

export const listApplicationGuide = (client, baseUrl) => api(client, baseUrl, "/api/v1/application-guide");

export const saveApplicationGuide = (client, baseUrl, body) =>
  api(client, baseUrl, "/api/v1/application-guide", { method: "POST", body });

export const listUnresolvedAutofillQuestions = (client, baseUrl, days = 30) =>
  api(client, baseUrl, `/api/v1/application-guide/unresolved-questions?days=${encodeURIComponent(days)}`);

export const dismissUnresolvedAutofillQuestion = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/application-guide/unresolved-questions/${encodeURIComponent(id)}/dismiss`, { method: "POST" });

export const deleteApplicationGuide = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/application-guide/${encodeURIComponent(id)}`, { method: "DELETE" });
