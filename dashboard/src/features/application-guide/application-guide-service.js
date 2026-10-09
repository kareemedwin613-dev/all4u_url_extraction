import { authenticatedApiRequest } from "../../services/api-client.js";

async function api(client, baseUrl, path, { method = "GET", body } = {}) {
  const { payload } = await authenticatedApiRequest(client, { baseUrl, path, method, body });
  return payload.data;
}

export const listApplicationGuide = (client, baseUrl) => api(client, baseUrl, "/api/v1/application-guide");

export const saveApplicationGuide = (client, baseUrl, body) =>
  api(client, baseUrl, "/api/v1/application-guide", { method: "POST", body });

export const deleteApplicationGuide = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/application-guide/${encodeURIComponent(id)}`, { method: "DELETE" });

// Question wordings AI recognition matched to Autofill answers, with this month's AI spend (Admins).
export const listLearnedAutofillWordings = (client, baseUrl) =>
  api(client, baseUrl, "/api/v1/application-guide/learned-wordings");

export const removeLearnedAutofillWording = (client, baseUrl, id) =>
  api(client, baseUrl, `/api/v1/application-guide/learned-wordings/${encodeURIComponent(id)}`, { method: "DELETE" });

// An Admin's correction: what a learned wording really asks for. The AI never overwrites it.
export const correctLearnedAutofillWording = (client, baseUrl, id, body) =>
  api(client, baseUrl, `/api/v1/application-guide/learned-wordings/${encodeURIComponent(id)}`, { method: "PUT", body });
