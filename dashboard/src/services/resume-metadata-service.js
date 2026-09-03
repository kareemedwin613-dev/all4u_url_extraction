import { authenticatedApiRequest } from "./api-client.js";

export async function updateResumeMetadata(client, apiBaseUrl, id, changes) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl,
    path: `/api/v1/resumes/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: changes,
    timeoutMs: 30000,
  });
  return payload.data;
}

