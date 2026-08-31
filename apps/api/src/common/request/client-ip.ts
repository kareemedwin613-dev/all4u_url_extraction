import type { Request } from "express";

export function resolveClientIp(request: Request): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(",")[0]?.trim() || null;
  }
  const ip = request.ip || request.socket?.remoteAddress;
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}
