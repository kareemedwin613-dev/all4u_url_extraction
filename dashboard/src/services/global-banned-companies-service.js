import { authenticatedApiRequest } from "./api-client.js";

export async function listGlobalBannedCompanies(client, apiBaseUrl) {
  const { payload } = await authenticatedApiRequest(client, { baseUrl: apiBaseUrl, path: "/api/v1/banned-companies" });
  return payload.data || [];
}

export async function addGlobalBannedCompany(client, apiBaseUrl, companyName, description) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: "/api/v1/banned-companies",
    method: "POST",
    body: { companyName, description },
  });
  return payload.data;
}

export async function updateGlobalBannedCompany(client, apiBaseUrl, id, description) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/banned-companies/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: { description },
  });
  return payload.data;
}

export async function removeGlobalBannedCompany(client, apiBaseUrl, id) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/banned-companies/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
  return payload.data;
}
