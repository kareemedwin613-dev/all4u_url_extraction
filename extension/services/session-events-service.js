import { apiRequest } from "./api-client.js";

export async function recordLogin(client, baseUrl, clientType = "EXTENSION") {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await apiRequest({
      baseUrl,
      path: "/api/v1/session-events/login",
      token,
      method: "POST",
      body: { clientType },
    });
  } catch {
    // Login should succeed even if audit recording fails.
  }
}
