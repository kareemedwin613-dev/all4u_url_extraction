import { authenticatedApiRequest } from "./api-client.js";

export async function recordLogin(client, apiBaseUrl, clientType = "DASHBOARD") {
  try {
    await authenticatedApiRequest(client, {
      baseUrl: apiBaseUrl,
      path: "/api/v1/session-events/login",
      method: "POST",
      body: { clientType },
    });
  } catch {
    // Login should succeed even if audit recording fails.
  }
}
