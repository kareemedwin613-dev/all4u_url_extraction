import { authenticatedApiRequest } from "./api-client.js";

const MAX_AVATAR_BYTES = 2097152;

export function validateAvatarFile(file) {
  const errors = {};
  if (!file) errors.file = "Choose an image file.";
  else if (!String(file.type || "").toLowerCase().startsWith("image/")) {
    errors.file = "Upload an image file.";
  } else if (!file.size || file.size > MAX_AVATAR_BYTES) {
    errors.file = "Avatar must be between 1 byte and 2 MiB.";
  }
  return { valid: !Object.keys(errors).length, errors };
}

async function avatarApi(client, baseUrl, path, { method = "GET", body } = {}) {
  const { payload } = await authenticatedApiRequest(client, {
    baseUrl,
    path,
    method,
    body,
  });
  return payload.data;
}

export async function getUserAvatarUrl(client, baseUrl, userId) {
  try {
    const data = await avatarApi(
      client,
      baseUrl,
      `/api/v1/users/${encodeURIComponent(userId)}/avatar/url`,
    );
    return data?.signedUrl || null;
  } catch (error) {
    if (
      error?.code === "USER_AVATAR_NOT_FOUND" ||
      String(error?.message || "").includes("does not have an avatar")
    ) {
      return null;
    }
    throw error;
  }
}

export async function uploadMyAvatar(client, baseUrl, file) {
  const check = validateAvatarFile(file);
  if (!check.valid) {
    throw { code: "VALIDATION_ERROR", message: Object.values(check.errors).join(" ") };
  }
  const body = new FormData();
  body.append("file", file, file.name);
  return avatarApi(client, baseUrl, "/api/v1/profile/avatar", { method: "POST", body });
}

export async function removeMyAvatar(client, baseUrl) {
  return avatarApi(client, baseUrl, "/api/v1/profile/avatar", { method: "DELETE" });
}

export async function uploadUserAvatar(client, baseUrl, userId, file) {
  const check = validateAvatarFile(file);
  if (!check.valid) {
    throw { code: "VALIDATION_ERROR", message: Object.values(check.errors).join(" ") };
  }
  const body = new FormData();
  body.append("file", file, file.name);
  return avatarApi(
    client,
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(userId)}/avatar`,
    { method: "POST", body },
  );
}

export async function removeUserAvatar(client, baseUrl, userId) {
  return avatarApi(
    client,
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(userId)}/avatar`,
    { method: "DELETE" },
  );
}
