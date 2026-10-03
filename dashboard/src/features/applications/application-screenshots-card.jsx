import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  LeftOutlined,
  RightOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { ErrorState, LoadingState } from "../../components/ui.jsx";
import { formatBytes, formatDate } from "../../shared/formatters.js";
import {
  attachApplicationScreenshot,
  getApplicationScreenshotUrl,
  listApplicationScreenshots,
  listApplications,
  openApplicationScreenshot,
  removeApplicationScreenshot,
  updateApplicationScreenshotFeedback,
  validateApplicationScreenshotFile,
} from "./application-service.js";
import { findReviewNeighbor } from "./screenshot-review.js";

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

function focusReviewFeedback(field) {
  const node = field?.resizableTextArea?.textArea || field;
  node?.focus?.();
}

export function ApplicationScreenshotsCard({
  client,
  apiBaseUrl,
  applicationId,
  manager = false,
  feedback = "",
  feedbackAt = null,
  feedbackReady = true,
  applicationNumber = null,
  companyName = "",
  reviewFilters = null,
  autoReview = false,
  onReviewNavigate,
  onCountChange,
  onFeedbackSaved,
}) {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [draftFeedback, setDraftFeedback] = useState(feedback || "");
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const feedbackRef = useRef(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const autoOpened = React.useRef("");
  const reviewLock = React.useRef(false);

  useEffect(() => {
    setDraftFeedback(feedback || "");
  }, [feedback, applicationId]);

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

  const showPreview = useCallback(async (screenshot) => {
    setPreview({ screenshot, url: "" });
    setPreviewLoading(true);
    setPreviewError("");
    setReviewNote("");
    setMistakesOpen(false);
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
  }, [apiBaseUrl, applicationId, client]);

  function closePreview() {
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(false);
    setMistakesOpen(false);
    setReviewNote("");
  }

  useEffect(() => {
    if (!autoReview || loading || !screenshots.length || autoOpened.current === applicationId) return;
    autoOpened.current = applicationId;
    showPreview(screenshots[0]);
  }, [autoReview, applicationId, loading, screenshots, showPreview]);

  const moveReview = useCallback(async (direction) => {
    if (!onReviewNavigate || reviewLock.current) return;
    reviewLock.current = true;
    setReviewBusy(true);
    setReviewNote("");
    try {
      const neighbor = await findReviewNeighbor(
        (pageFilters) => listApplications(client, apiBaseUrl, pageFilters),
        reviewFilters || {},
        applicationId,
        direction,
      );
      if (!neighbor) {
        setReviewNote(direction === "previous" ? "No earlier screenshot in this list." : "No further screenshots in this list.");
        return;
      }
      onReviewNavigate(neighbor.id, neighbor.page);
    } catch (value) {
      setReviewNote(value.message || "The next screenshot could not be opened.");
    } finally {
      reviewLock.current = false;
      setReviewBusy(false);
    }
  }, [apiBaseUrl, applicationId, client, onReviewNavigate, reviewFilters]);

  useEffect(() => {
    if (!preview) return undefined;
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || event.target?.isContentEditable) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (savingFeedback || reviewBusy) return;
      moveReview(event.key === "ArrowLeft" ? "previous" : "next");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveReview, preview, reviewBusy, savingFeedback]);

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

  async function saveFeedback(nextValue, { advance = false, reviewStatus = "" } = {}) {
    if (!feedbackReady || reviewLock.current) return false;
    reviewLock.current = true;
    setSavingFeedback(true);
    setFeedbackError("");
    setReviewNote("");
    try {
      const neighbor = advance && onReviewNavigate
        ? await findReviewNeighbor(
          (pageFilters) => listApplications(client, apiBaseUrl, pageFilters),
          reviewFilters || {},
          applicationId,
          "next",
        )
        : null;
      const updated = await updateApplicationScreenshotFeedback(
        client,
        apiBaseUrl,
        applicationId,
        nextValue,
        reviewStatus,
      );
      setDraftFeedback(updated?.screenshot_feedback || "");
      setMistakesOpen(false);
      onFeedbackSaved?.(updated);
      if (advance && neighbor) onReviewNavigate(neighbor.id, neighbor.page);
      else if (advance) setReviewNote("No further screenshots in this list.");
      return true;
    } catch (value) {
      setFeedbackError(value.message || "Screenshot feedback could not be saved.");
      return false;
    } finally {
      reviewLock.current = false;
      setSavingFeedback(false);
    }
  }

  const trimmedFeedback = String(feedback || "").trim();
  const draftDirty = String(draftFeedback || "") !== String(feedback || "");
  const applicationCaption = [
    applicationNumber ? `Application #${applicationNumber}` : "",
    companyName || "",
  ].filter(Boolean).join(" · ");
  const previewTitle = preview?.screenshot?.original_filename || "Screenshot";

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

        <div style={{ marginTop: 16 }}>
          {manager ? (
            <>
              <Text strong>Screenshot review feedback</Text>
              <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                Notes about mistakes found while reviewing confirmation screenshots. Visible to the assigned Applier.
              </Text>
              <Input.TextArea
                rows={4}
                maxLength={2000}
                showCount
                value={draftFeedback}
                onChange={(event) => setDraftFeedback(event.target.value)}
                placeholder="Describe what is wrong or missing in the confirmation screenshots…"
                disabled={savingFeedback}
              />
              {feedbackError ? (
                <ErrorState message={feedbackError} />
              ) : null}
              <Space wrap style={{ marginTop: 8 }}>
                <Button
                  type="primary"
                  loading={savingFeedback}
                  disabled={!draftDirty}
                  onClick={() => saveFeedback(draftFeedback, { reviewStatus: "HAS_MISTAKES" })}
                >
                  Save feedback
                </Button>
                {trimmedFeedback ? (
                  <Button
                    danger
                    loading={savingFeedback}
                    onClick={() => saveFeedback("")}
                  >
                    Clear feedback
                  </Button>
                ) : null}
                {feedbackAt ? (
                  <Text type="secondary">Updated {formatDate(feedbackAt)}</Text>
                ) : null}
              </Space>
            </>
          ) : trimmedFeedback ? (
            <Alert
              type="warning"
              showIcon
              message="Screenshot review feedback"
              description={
                <>
                  <Text className="long-text">{trimmedFeedback}</Text>
                  {feedbackAt ? (
                    <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                      Updated {formatDate(feedbackAt)}
                    </Text>
                  ) : null}
                </>
              }
            />
          ) : null}
        </div>
      </Card>

      <Modal
        open={Boolean(preview)}
        className="application-screenshot-review"
        title={previewTitle}
        footer={
          <Flex justify="space-between" gap={12} wrap="wrap">
            <Space wrap>
              {onReviewNavigate ? (
                <>
                  <Button icon={<LeftOutlined />} disabled={reviewBusy || savingFeedback} onClick={() => moveReview("previous")}>
                    Previous
                  </Button>
                  <Button icon={<RightOutlined />} disabled={reviewBusy || savingFeedback} onClick={() => moveReview("next")}>
                    Next
                  </Button>
                </>
              ) : null}
            </Space>
            {manager ? (
              <Space wrap>
                <Button
                  icon={<CheckOutlined />}
                  type="primary"
                  loading={savingFeedback}
                  disabled={!feedbackReady || reviewBusy}
                  onClick={() => saveFeedback("", { advance: Boolean(onReviewNavigate), reviewStatus: "CORRECT" })}
                >
                  Correct
                </Button>
                <Button
                  icon={<EditOutlined />}
                  disabled={!feedbackReady || reviewBusy || savingFeedback}
                  onClick={() => { setMistakesOpen(true); window.setTimeout(() => focusReviewFeedback(feedbackRef.current), 0); }}
                >
                  Has mistakes
                </Button>
              </Space>
            ) : null}
            <Space wrap>
              <Button onClick={closePreview}>Close</Button>
              {preview?.url ? (
                <Button icon={<DownloadOutlined />} href={preview.url} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </Button>
              ) : null}
            </Space>
          </Flex>
        }
        onCancel={closePreview}
        maskClosable={false}
        keyboard={false}
        width="96vw"
        style={{ top: 12, maxWidth: 1600 }}
        destroyOnHidden
      >
        <div className="application-screenshot-scroll">
          {applicationCaption ? (
            <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              {applicationCaption}
            </Text>
          ) : null}
          {previewLoading ? (
            <Flex align="center" justify="center" style={{ minHeight: 360 }}>
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
          {reviewNote ? (
            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              {reviewNote}
            </Text>
          ) : null}
        </div>
        {manager && mistakesOpen ? (
          <div className="application-screenshot-feedback">
            <Text strong>Screenshot review feedback</Text>
            <Input.TextArea
              ref={feedbackRef}
              autoFocus
              rows={4}
              maxLength={2000}
              showCount
              style={{ marginTop: 8 }}
              value={draftFeedback}
              onChange={(event) => setDraftFeedback(event.target.value)}
              placeholder="Describe what is wrong or missing in the confirmation screenshot…"
              disabled={savingFeedback}
            />
            {feedbackError ? <ErrorState message={feedbackError} /> : null}
            <Space style={{ marginTop: 8 }}>
              <Button type="primary" loading={savingFeedback} disabled={!feedbackReady || !draftDirty} onClick={() => saveFeedback(draftFeedback, { advance: true, reviewStatus: "HAS_MISTAKES" })}>
                Save feedback
              </Button>
              <Button disabled={savingFeedback} onClick={() => { setMistakesOpen(false); setDraftFeedback(feedback || ""); }}>
                Cancel
              </Button>
            </Space>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
