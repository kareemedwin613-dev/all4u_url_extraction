import { authenticatedApiRequest } from "./api-client.js";

export async function listResumeBannedCompanies(client, apiBaseUrl, resumeId) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/resumes/${encodeURIComponent(resumeId)}/banned-companies`,
  });
  return payload.data || [];
}

export async function addResumeBannedCompany(client, apiBaseUrl, resumeId, companyName) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/resumes/${encodeURIComponent(resumeId)}/banned-companies`,
    method: "POST",
    body: { companyName },
  });
  return payload.data;
}

export async function removeResumeBannedCompany(client, apiBaseUrl, resumeId, entryId) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/resumes/${encodeURIComponent(resumeId)}/banned-companies/${encodeURIComponent(entryId)}`,
    method: "DELETE",
  });
  return payload.data;
}
