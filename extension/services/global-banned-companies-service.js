import { AppError } from "../shared/errors.js";
import { apiRequest } from "./api-client.js";

async function token(client) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new AppError("SESSION_EXPIRED", "Your session has expired. Sign in again.");
  return data.session.access_token;
}

export async function listGlobalBannedCompanies(client, baseUrl) {
  const payload = await apiRequest({ baseUrl, path: "/api/v1/banned-companies", token: await token(client) });
  return Array.isArray(payload.data) ? payload.data : [];
}
