import {authenticatedApiRequest} from "./api-client.js";
export async function screenshotReviewRequest(client, apiBaseUrl, operation, body = {}) {
  const {payload} = await authenticatedApiRequest(client, {
    baseUrl: apiBaseUrl, path: "/api/v1/screenshot-review-batches", method: "POST", body: {operation, ...body}, timeoutMs: 30000,
  });
  return payload.data;
}
