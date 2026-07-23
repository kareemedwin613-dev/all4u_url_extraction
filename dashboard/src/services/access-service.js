import {normalizeAccessContext, accessError} from "../access/access-context.js";
import {normalizeAccessError} from "./admin-user-service.js";

export async function getMyAccessContext(client) {
  try {
    const {data, error} = await client.rpc("get_my_access_context");
    if (error) throw error;
    return normalizeAccessContext(data);
  } catch (error) {
    if (error?.code === "ACCESS_CONTEXT_FAILED") throw error;
    const normalized = normalizeAccessError(error, "ACCESS_CONTEXT_FAILED", "Your access context could not be loaded.");
    throw accessError(normalized.code, normalized.message, normalized.retryable);
  }
}

export async function listSystemRoles(client) {
  const {data, error} = await client.from("roles").select("id,code,name,description,active,is_system,created_at").order("code");
  if (error) throw normalizeAccessError(error, "DATA_REQUEST_FAILED", "System roles could not be loaded.");
  return data || [];
}
