import React, { useEffect, useState } from "react";
import { Avatar } from "antd";
import { getUserAvatarUrl } from "../services/avatar-service.js";
import { avatarColor, personInitials } from "../shared/avatar.js";

const urlCache = new Map();

function cacheKey(userId, avatarUpdatedAt) {
  return `${userId}:${avatarUpdatedAt || "none"}`;
}

export function UserAvatar({
  client,
  apiBaseUrl,
  userId,
  name,
  size = 36,
  hasAvatar,
  avatarUpdatedAt,
  className,
  style,
}) {
  const [src, setSrc] = useState(undefined);
  const label = personInitials(name);
  const color = avatarColor(userId || name);

  useEffect(() => {
    let active = true;
    if (!client || !apiBaseUrl || !userId || hasAvatar === false) {
      setSrc(null);
      return undefined;
    }

    const key = cacheKey(userId, avatarUpdatedAt);
    const cached = urlCache.get(key);
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    getUserAvatarUrl(client, apiBaseUrl, userId)
      .then((url) => {
        if (!active) return;
        if (url) urlCache.set(key, url);
        setSrc(url);
      })
      .catch(() => {
        if (!active) return;
        setSrc(null);
      });

    return () => {
      active = false;
    };
  }, [apiBaseUrl, avatarUpdatedAt, client, hasAvatar, userId]);

  return (
    <Avatar
      className={className}
      size={size}
      src={src || undefined}
      style={{ backgroundColor: color, flex: "none", ...style }}
    >
      {label}
    </Avatar>
  );
}

export function clearAvatarUrlCache(userId, avatarUpdatedAt) {
  if (userId) urlCache.delete(cacheKey(userId, avatarUpdatedAt));
  else urlCache.clear();
}
