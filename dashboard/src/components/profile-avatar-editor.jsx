import React, { useEffect, useState } from "react";
import { Button, Flex, Popconfirm, Space, Typography, Upload } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import {
  removeMyAvatar,
  removeUserAvatar,
  uploadMyAvatar,
  uploadUserAvatar,
  validateAvatarFile,
} from "../services/avatar-service.js";
import { clearAvatarUrlCache, UserAvatar } from "./user-avatar.jsx";

const { Text } = Typography;
const ACCEPT = "image/*";

export function ProfileAvatarEditor({
  client,
  apiBaseUrl,
  userId,
  name,
  hasAvatar = false,
  avatarUpdatedAt,
  admin = false,
  onChanged,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localHasAvatar, setLocalHasAvatar] = useState(hasAvatar);
  const [localUpdatedAt, setLocalUpdatedAt] = useState(avatarUpdatedAt);

  useEffect(() => {
    setLocalHasAvatar(hasAvatar);
    setLocalUpdatedAt(avatarUpdatedAt);
  }, [avatarUpdatedAt, hasAvatar]);

  async function refresh(result) {
    const nextHasAvatar = Boolean(result?.hasAvatar);
    const nextUpdatedAt = result?.avatarUpdatedAt || new Date().toISOString();
    clearAvatarUrlCache(userId, localUpdatedAt);
    clearAvatarUrlCache(userId, nextUpdatedAt);
    setLocalHasAvatar(nextHasAvatar);
    setLocalUpdatedAt(nextUpdatedAt);
    await onChanged?.(result);
  }

  async function upload(file) {
    const check = validateAvatarFile(file);
    if (!check.valid) {
      setError(Object.values(check.errors).join(" "));
      return Upload.LIST_IGNORE;
    }
    setBusy(true);
    setError("");
    try {
      const result = admin
        ? await uploadUserAvatar(client, apiBaseUrl, userId, file)
        : await uploadMyAvatar(client, apiBaseUrl, file);
      await refresh(result);
    } catch (value) {
      setError(value.message || "The avatar could not be uploaded.");
    } finally {
      setBusy(false);
    }
    return Upload.LIST_IGNORE;
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const result = admin
        ? await removeUserAvatar(client, apiBaseUrl, userId)
        : await removeMyAvatar(client, apiBaseUrl);
      await refresh(result);
    } catch (value) {
      setError(value.message || "The avatar could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-avatar-editor">
      <Flex align="center" wrap="wrap" gap={16}>
        <UserAvatar
          client={client}
          apiBaseUrl={apiBaseUrl}
          userId={userId}
          name={name}
          size={72}
          hasAvatar={localHasAvatar}
          avatarUpdatedAt={localUpdatedAt}
        />
        <Space direction="vertical" size={8}>
          <Upload accept={ACCEPT} showUploadList={false} beforeUpload={upload} disabled={busy}>
            <Button icon={<UploadOutlined />} loading={busy}>
              Upload avatar
            </Button>
          </Upload>
          {localHasAvatar ? (
            <Popconfirm
              title="Remove this avatar?"
              okText="Remove"
              okButtonProps={{ danger: true, loading: busy }}
              onConfirm={remove}
            >
              <Button danger icon={<DeleteOutlined />} loading={busy}>
                Remove avatar
              </Button>
            </Popconfirm>
          ) : null}
          <Text type="secondary" style={{ fontSize: 12 }}>
            PNG, JPG, WEBP, GIF, and other image files up to 2 MiB.
          </Text>
          {error ? (
            <Text type="danger" style={{ fontSize: 12 }}>
              {error}
            </Text>
          ) : null}
        </Space>
      </Flex>
    </div>
  );
}
