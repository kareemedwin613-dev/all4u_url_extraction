import {normalizeAccessError} from "./admin-user-service.js";

export async function updateMyProfile(client, fullName) {
  const value = String(fullName || "").trim();
  if (value.length > 200) throw {code: "VALIDATION_ERROR", message: "Full name must be at most 200 characters.", retryable: false};
  const {data, error} = await client.rpc("update_my_profile", {p_full_name: value});
  if (error) throw normalizeAccessError(error);
  return data;
}
