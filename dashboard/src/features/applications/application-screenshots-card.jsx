import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Flex,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { ErrorState, LoadingState } from "../../components/ui.jsx";
import { formatBytes, formatDate } from "../../shared/formatters.js";
import {
  attachApplicationScreenshot,
  getApplicationScreenshotUrl,
  listApplicationScreenshots,
  openApplicationScreenshot,
  removeApplicationScreenshot,
  validateApplicationScreenshotFile,
} from "./application-service.js";

const { Text } = Typography;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

function screenshotLabel(mimeType = "") {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/jpeg") return "JPG";
  if (mimeType === "image/webp") return "WEBP";
  return "File";
}

function isImageMime(mimeType = "") {
  return String(mimeType).startsWith("image/");
}

export function ApplicationScreenshotsCard({
  client,
  apiBaseUrl,
  applicationId,
  onCountChange,
}) {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    return listApplicationScreenshots(client, apiBaseUrl, applicationId)
      .then((rows) => {
        const next = Array.isArray(rows) ? rows : [];
        setScreenshots(next);
        onCountChange?.(next.length);
        setLoading(false);
        return next;
      })
      .catch((value) => {
        setError(value.message || "Screenshots could not be loaded.");
        setLoading(false);
        throw value;
      });
  }, [apiBaseUrl, applicationId, client, onCountChange]);

  useEffect(() => {
    let active = true;
    refresh().catch(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function showPreview(screenshot) {
    setPreview({ screenshot, url: "" });
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const data = await getApplicationScreenshotUrl(
        client,
        apiBaseUrl,
        applicationId,
        screenshot.id,
      );
      setPreview({ screenshot, url: data.signedUrl });
    } catch (value) {
      setPreviewError(value.message || "The screenshot could not be opened.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
  }

  async function uploadScreenshot(file) {
    const check = validateApplicationScreenshotFile(file);
    if (!check.valid) {
      setError(Object.values(check.errors).join(" "));
      return Upload.LIST_IGNORE;
    }
    setUploading(true);
    setError("");
    try {
      await attachApplicationScreenshot(client, apiBaseUrl, applicationId, file);
      await refresh();
    } catch (value) {
      setError(value.message || "The screenshot could not be uploaded.");
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  }

  async function deleteScreenshot(screenshot) {
    setRemovingId(screenshot.id);
    setError("");
    try {
      await removeApplicationScreenshot(client, apiBaseUrl, applicationId, screenshot.id);
      if (preview?.screenshot?.id === screenshot.id) closePreview();
      await refresh();
    } catch (value) {
      setError(value.message || "The screenshot could not be removed.");
    } finally {
      setRemovingId("");
    }
  }

  return (
    <>
      <Card
        title="Confirmation Screenshots"
        extra={
          screenshots.length ? (
            <Tag icon={<FileImageOutlined />}>{screenshots.length} attached</Tag>
          ) : null
        }
      >
        <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{ marginBottom: 12 }}>
          <Text type="secondary">
            Proof-of-submission files attached when this Application was marked Applied.
          </Text>
          <Upload
            accept={ACCEPT}
            showUploadList={false}
            beforeUpload={uploadScreenshot}
            disabled={uploading}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              Upload screenshot
            </Button>
          </Upload>
        </Flex>
        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <LoadingState text="Loading screenshots…" />
        ) : !screenshots.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No confirmation screenshots attached yet."
          />
        ) : (
          <div className="application-screenshots-grid">
            {screenshots.map((screenshot) => (
              <div key={screenshot.id} className="application-screenshot-card">
                <div className="application-screenshot-card__icon">
                  {screenshot.mime_type === "application/pdf" ? (
                    <FilePdfOutlined />
                  ) : (
                    <FileImageOutlined />
                  )}
                </div>
                <div className="application-screenshot-card__body">
                  <Text strong ellipsis title={screenshot.original_filename}>
                    {screenshot.original_filename}
                  </Text>
                  <Space size={[8, 4]} wrap style={{ marginTop: 4 }}>
                    <Tag>{screenshotLabel(screenshot.mime_type)}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatBytes(screenshot.file_size_bytes)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(screenshot.created_at)}
                    </Text>
                  </Space>
                </div>
                <Flex gap={8} wrap="wrap" style={{ marginTop: 12 }}>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => showPreview(screenshot)}
                  >
                    View
                  </Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() =>
                      openApplicationScreenshot(
                        client,
                        apiBaseUrl,
                        applicationId,
                        screenshot,
                      ).catch((value) => setError(value.message))
                    }
                  >
                    Open
                  </Button>
                  <Popconfirm
                    title="Remove this screenshot?"
                    description="This permanently deletes the attached file."
                    okText="Remove"
                    okButtonProps={{ danger: true, loading: removingId === screenshot.id }}
                    onConfirm={() => deleteScreenshot(screenshot)}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={removingId === screenshot.id}
                    >
                      Remove
                    </Button>
                  </Popconfirm>
                </Flex>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(preview)}
        title={preview?.screenshot?.original_filename || "Screenshot"}
        footer={
          preview?.url ? (
            <Space>
              <Button onClick={closePreview}>Close</Button>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in new tab
              </Button>
            </Space>
          ) : (
            <Button onClick={closePreview}>Close</Button>
          )
        }
        onCancel={closePreview}
        width={isImageMime(preview?.screenshot?.mime_type) ? 920 : 720}
        destroyOnClose
      >
        {previewLoading ? (
          <Flex align="center" justify="center" style={{ minHeight: 240 }}>
            <Spin tip="Loading preview…" />
          </Flex>
        ) : previewError ? (
          <ErrorState message={previewError} retry={() => showPreview(preview.screenshot)} />
        ) : preview?.url && isImageMime(preview.screenshot.mime_type) ? (
          <img
            src={preview.url}
            alt={preview.screenshot.original_filename}
            className="application-screenshot-preview"
          />
        ) : preview?.url ? (
          <iframe
            title={preview.screenshot.original_filename}
            src={preview.url}
            className="application-screenshot-preview application-screenshot-preview--pdf"
          />
        ) : null}
      </Modal>
    </>
  );
}
