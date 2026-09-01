import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

const MAX_AVATAR_BYTES = 2097152;
const AVATAR_BUCKET = "user-avatars";
const safeName = (value: string) =>
  String(value || "avatar")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(-180) || "avatar";

function failure(error: any, fallback: string): never {
  const raw = String(error?.message || "");
  const known = raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
  const code =
    known?.[1] ||
    (error?.code === "42501" ? "ACCESS_DENIED" : "DATABASE_ERROR");
  const status =
    error?.code === "42501" || code.includes("ACCESS")
      ? 403
      : code.includes("NOT_FOUND")
        ? 404
        : known
          ? 400
          : 502;
  throw new ApiException(code, known?.[2] || fallback, status);
}

@Injectable()
export class UserAvatarService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  private async rpc(
    user: AuthenticatedUser,
    name: string,
    args: Record<string, unknown>,
    fallback: string,
  ) {
    const { data, error } = await this.supabase
      .forUser(user.token)
      .rpc(name, args);
    if (error) failure(error, fallback);
    return data;
  }

  private validateAvatarFile(file: any) {
    if (!file || file.size < 1 || file.size > MAX_AVATAR_BYTES) {
      throw new ApiException(
        "USER_AVATAR_INVALID_SIZE",
        "Use an image file between 1 byte and 2 MiB.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!String(file.mimetype || "").toLowerCase().startsWith("image/")) {
      throw new ApiException(
        "USER_AVATAR_INVALID_TYPE",
        "Upload an image file.",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async removeStoredPath(
    client: ReturnType<SupabaseService["forUser"]>,
    bucket: string | null | undefined,
    path: string | null | undefined,
  ) {
    if (!path) return;
    await client.storage.from(bucket || AVATAR_BUCKET).remove([path]);
  }

  async upload(user: AuthenticatedUser, targetUserId: string, file: any) {
    this.validateAvatarFile(file);
    const path = `${targetUserId}/${randomUUID()}-${safeName(file.originalname)}`;
    const client = this.supabase.forUser(user.token);
    const uploaded = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) failure(uploaded.error, "The avatar file could not be uploaded.");
    try {
      const result: any = await this.rpc(
        user,
        "set_user_avatar_v35",
        {
          p_user_id: targetUserId,
          p_storage_path: path,
          p_original_filename: file.originalname,
          p_mime_type: file.mimetype,
          p_file_size_bytes: file.size,
        },
        "The avatar could not be saved.",
      );
      await this.removeStoredPath(
        client,
        result?.previousStorageBucket,
        result?.previousStoragePath,
      );
      return result;
    } catch (error) {
      await client.storage.from(AVATAR_BUCKET).remove([path]);
      throw error;
    }
  }

  async remove(user: AuthenticatedUser, targetUserId: string) {
    const client = this.supabase.forUser(user.token);
    const result: any = await this.rpc(
      user,
      "remove_user_avatar_v35",
      { p_user_id: targetUserId },
      "The avatar could not be removed.",
    );
    await this.removeStoredPath(
      client,
      result?.previousStorageBucket,
      result?.previousStoragePath,
    );
    return result;
  }

  async signedUrl(user: AuthenticatedUser, targetUserId: string) {
    const meta: any = await this.rpc(
      user,
      "get_user_avatar_v35",
      { p_user_id: targetUserId },
      "The avatar could not be loaded.",
    );
    const { data, error } = await this.supabase
      .forUser(user.token)
      .storage.from(meta.storageBucket || AVATAR_BUCKET)
      .createSignedUrl(meta.storagePath, 90);
    if (error || !data?.signedUrl) {
      failure(error, "The avatar could not be opened.");
    }
    return {
      signedUrl: data.signedUrl,
      expiresInSeconds: 90,
      filename: meta.originalFilename,
      mimeType: meta.mimeType,
      updatedAt: meta.updatedAt,
    };
  }
}
