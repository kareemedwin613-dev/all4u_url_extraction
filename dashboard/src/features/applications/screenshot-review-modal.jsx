import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Flex, Input, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import { CheckOutlined, CompressOutlined, DownloadOutlined, EditOutlined, ExpandOutlined, LeftOutlined, RightOutlined, WarningOutlined } from "@ant-design/icons";
import { ErrorState } from "../../components/ui.jsx";
import {
  getApplicationScreenshotUrl,
  listApplicationScreenshots,
  listApplications,
  listScreenshotPreviews,
  updateApplicationScreenshotFeedback,
} from "./application-service.js";
import { findReviewNeighbor, loadedReviewNeighbor, SCREENSHOT_ZOOM_STEPS, screenshotPrefetchIds, screenshotReviewStatus, stepScreenshotZoom, upcomingScreenshotIds } from "./screenshot-review.js";

const { Text } = Typography;

function isImageMime(mimeType = "") {
  return String(mimeType).startsWith("image/");
}

function previewReady(entry) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

async function loadPreviewBatch(client, apiBaseUrl, ids) {
  try {
    return await listScreenshotPreviews(client, apiBaseUrl, ids);
  } catch (error) {
    const items = [];
    await Promise.all(ids.map(async (applicationId) => {
      try {
        const rows = await listApplicationScreenshots(client, apiBaseUrl, applicationId);
        const screenshot = Array.isArray(rows) ? rows[0] : null;
        if (!screenshot) return;
        const data = await getApplicationScreenshotUrl(client, apiBaseUrl, applicationId, screenshot.id);
        if (!data?.signedUrl) return;
        items.push({ applicationId, signedUrl: data.signedUrl, screenshot });
      } catch {
        // A neighbor can fail without blocking the screenshot on screen.
      }
    }));
    if (!items.length) throw error;
    return { items };
  }
}

function warmScreenshot(url, mimeType) {
  if (!url || !String(mimeType || "").startsWith("image/")) return;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

export function ScreenshotReviewModal({
  client,
  apiBaseUrl,
  manager = false,
  review,
  filters,
  onClose,
  onMove,
  onFeedbackSaved,
}) {
  const application = review?.application;
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [draftFeedback, setDraftFeedback] = useState("");
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);
  const stageRef = useRef(null);
  const cache = useRef(new Map());
  const inflight = useRef(new Map());
  const itemsRef = useRef(review?.items || []);
  const lock = useRef(false);
  const ticketRef = useRef(0);
  const nextPageRef = useRef({ page: 0, ids: [] });
  const filtersRef = useRef(filters);
  itemsRef.current = review?.items || [];
  filtersRef.current = filters;

  const ensurePreviews = useCallback(async (ids) => {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const missing = unique.filter((id) => !previewReady(cache.current.get(id)) && !inflight.current.has(id));
    if (missing.length) {
      const job = loadPreviewBatch(client, apiBaseUrl, missing).then((data) => {
        const found = new Set();
        for (const item of data?.items || []) {
          if (!item?.applicationId || !item?.signedUrl) continue;
          found.add(item.applicationId);
          const loaded = {
            url: item.signedUrl,
            screenshot: item.screenshot,
            expiresAt: Date.now() + 9 * 60 * 1000,
          };
          cache.current.set(item.applicationId, loaded);
          warmScreenshot(loaded.url, loaded.screenshot?.mime_type);
        }
        for (const id of missing) {
          if (!found.has(id) && !previewReady(cache.current.get(id))) {
            cache.current.set(id, { url: "", screenshot: null, expiresAt: Date.now() + 30_000 });
          }
        }
      }).finally(() => {
        for (const id of missing) inflight.current.delete(id);
      });
      for (const id of missing) inflight.current.set(id, job);
    }
    await Promise.all(unique.map((id) => inflight.current.get(id) || Promise.resolve()));
  }, [apiBaseUrl, client]);

  useEffect(() => {
    if (!application?.id) return undefined;
    setDraftFeedback(application.screenshot_feedback || "");
    return undefined;
  }, [application?.id, application?.screenshot_feedback]);

  useEffect(() => {
    if (!application?.id) return undefined;
    let cancelled = false;
    const ticket = ++ticketRef.current;
    const applicationId = application.id;
    const cached = cache.current.get(applicationId);
    setNote("");
    setMistakesOpen(false);
    if (previewReady(cached) && cached.url) {
      setPreview(cached);
      setPreviewLoading(false);
      setPreviewError("");
    } else {
      setPreviewLoading(true);
      setPreviewError("");
    }
    const ids = screenshotPrefetchIds(itemsRef.current, applicationId);
    ensurePreviews(ids.length ? ids : [applicationId]).then(() => {
      if (cancelled || ticket !== ticketRef.current) return;
      const loaded = cache.current.get(applicationId);
      if (!loaded?.url) {
        setPreview(null);
        setPreviewError("No screenshot is attached.");
        return;
      }
      setPreview(loaded);
      setPreviewError("");
    }).catch((value) => {
      if (cancelled || ticket !== ticketRef.current) return;
      const loaded = cache.current.get(applicationId);
      if (previewReady(loaded) && loaded.url) return;
      setPreview(null);
      setPreviewError(value.message || "The screenshot could not be opened.");
    }).finally(() => {
      if (!cancelled && ticket === ticketRef.current) setPreviewLoading(false);
    });
    if (upcomingScreenshotIds(itemsRef.current, applicationId, 4).length < 4) {
      const nextPage = (Number(review?.page) || 1) + 1;
      const remembered = nextPageRef.current.page === nextPage ? nextPageRef.current.ids : null;
      const loadNextPage = remembered
        ? Promise.resolve(remembered)
        : listApplications(client, apiBaseUrl, { ...filtersRef.current, page: nextPage, pageSize: filtersRef.current?.pageSize || 25 })
          .then((data) => {
            const nextIds = (data?.items || []).filter((item) => Number(item.screenshot_count) > 0).slice(0, 4).map((item) => item.id);
            nextPageRef.current = { page: nextPage, ids: nextIds };
            return nextIds;
          });
      loadNextPage.then((nextIds) => {
        if (cancelled || !nextIds?.length) return null;
        return ensurePreviews(nextIds);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, application?.id, client, ensurePreviews, reloadKey, review?.page]);

  const moveTo = useCallback(async (direction) => {
    const local = loadedReviewNeighbor(review.items, application.id, direction);
    if (local.located && local.item) {
      onMove({ application: local.item, items: review.items, page: review.page });
      return true;
    }
    const neighbor = await findReviewNeighbor(
      (pageFilters) => listApplications(client, apiBaseUrl, pageFilters),
      { ...filters, page: review.page },
      application.id,
      direction,
    );
    if (!neighbor?.item) return false;
    onMove({ application: neighbor.item, items: neighbor.items || review.items, page: neighbor.page });
    return true;
  }, [apiBaseUrl, application, client, filters, onMove, review]);

  const move = useCallback(async (direction) => {
    if (!application || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNote("");
    try {
      const found = await moveTo(direction);
      if (!found) setNote(direction === "previous" ? "No earlier screenshot in this list." : "No further screenshots in this list.");
    } catch (value) {
      setNote(value.message || "The next screenshot could not be opened.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [application, moveTo]);

  useEffect(() => {
    if (!application) return undefined;
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || event.target?.isContentEditable) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (saving || busy) return;
      move(event.key === "ArrowLeft" ? "previous" : "next");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [application, busy, move, saving]);

  async function saveFeedback(nextValue, { advance = false, reviewStatus = "" } = {}) {
    if (!application || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const neighbor = advance ? loadedReviewNeighbor(review.items, application.id, "next") : null;
      const updated = await updateApplicationScreenshotFeedback(client, apiBaseUrl, application.id, nextValue, reviewStatus);
      const patch = {
        screenshot_feedback: updated?.screenshot_feedback || "",
        screenshot_feedback_at: updated?.screenshot_feedback_at || null,
        screenshot_review_status: updated?.screenshot_review_status || reviewStatus || "",
      };
      const items = (review.items || []).map((item) => item.id === application.id ? { ...item, ...patch } : item);
      setDraftFeedback(patch.screenshot_feedback);
      setMistakesOpen(false);
      onFeedbackSaved?.(application.id, { ...updated, ...patch });
      if (!advance) return;
      if (neighbor?.located && neighbor.item) {
        onMove({
          application: items.find((item) => item.id === neighbor.item.id) || neighbor.item,
          items,
          page: review.page,
        });
        return;
      }
      const found = await moveTo("next");
      if (!found) setNote("No further screenshots in this list.");
    } catch (value) {
      setError(value.message || "Screenshot feedback could not be saved.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    function onWheel(event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((current) => stepScreenshotZoom(current, event.deltaY < 0 ? 1 : -1));
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [application?.id, preview?.url, previewLoading]);
  const caption = [
    application?.application_number ? `Application #${application.application_number}` : "",
    application?.company || "",
  ].filter(Boolean).join(" · ");
  const reviewStatus = screenshotReviewStatus(application);
  const draftDirty = String(draftFeedback || "") !== String(application?.screenshot_feedback || "");

  return (
    <Modal
      open={Boolean(application)}
      className={maximized ? "application-screenshot-review application-screenshot-review--max" : "application-screenshot-review"}
      title={
        <Flex align="center" justify="space-between" gap={12} style={{ paddingRight: 28 }}>
          <Space size={8} style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
            {reviewStatus === "CORRECT" ? <Tag color="success" icon={<CheckOutlined />}>Correct</Tag> : null}
            {reviewStatus === "HAS_MISTAKES" ? <Tag color="warning" icon={<WarningOutlined />}>Has mistakes</Tag> : null}
            {!reviewStatus ? <Tag>Not checked</Tag> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{preview?.screenshot?.original_filename || "Screenshot"}</span>
          </Space>
          <Space size={4}>
            <Select
              aria-label="Screenshot size"
              value={zoom}
              popupMatchSelectWidth={false}
              options={SCREENSHOT_ZOOM_STEPS.map((value) => ({ value, label: `${value}%` }))}
              onChange={setZoom}
              style={{ width: 88 }}
            />
            <Button
              type="text"
              icon={maximized ? <CompressOutlined /> : <ExpandOutlined />}
              aria-label={maximized ? "Minimize screenshot" : "Maximize screenshot"}
              onClick={() => setMaximized((current) => !current)}
            >
              {maximized ? "Minimize" : "Maximize"}
            </Button>
          </Space>
        </Flex>
      }
      footer={
        <Flex justify="space-between" gap={12} wrap="wrap">
          <Space wrap>
            <Button icon={<LeftOutlined />} disabled={busy || saving} onClick={() => move("previous")}>Previous</Button>
            <Button icon={<RightOutlined />} disabled={busy || saving} onClick={() => move("next")}>Next</Button>
          </Space>
          {manager ? (
            <Space wrap>
              <Button icon={<CheckOutlined />} type="primary" loading={saving} disabled={busy} onClick={() => saveFeedback("", { advance: true, reviewStatus: "CORRECT" })}>Correct</Button>
              <Button icon={<EditOutlined />} disabled={busy || saving} onClick={() => setMistakesOpen(true)}>Has mistakes</Button>
            </Space>
          ) : null}
          <Space wrap>
            <Button onClick={onClose}>Close</Button>
            {preview?.url ? (
              <Button icon={<DownloadOutlined />} href={preview.url} target="_blank" rel="noopener noreferrer">Open in new tab</Button>
            ) : null}
          </Space>
        </Flex>
      }
      onCancel={onClose}
      width={maximized ? "100vw" : "96vw"}
      style={maximized ? { top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 } : { top: 12, maxWidth: 1600 }}
      destroyOnHidden
    >
      {caption ? <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>{caption}</Text> : null}
      {previewLoading ? (
        <Flex align="center" justify="center" style={{ minHeight: 360 }}><Spin tip="Loading preview…" /></Flex>
      ) : previewError ? (
        <ErrorState message={previewError} retry={() => { cache.current.delete(application.id); setReloadKey((value) => value + 1); }} />
      ) : preview?.url ? (
        <div ref={stageRef} className="application-screenshot-stage">
          {isImageMime(preview.screenshot.mime_type) ? (
            <img
              src={preview.url}
              alt={preview.screenshot.original_filename}
              className="application-screenshot-preview application-screenshot-preview--scaled"
              decoding="async"
              fetchPriority="high"
              style={{ width: `${zoom}%` }}
            />
          ) : (
            <iframe
              title={preview.screenshot.original_filename}
              src={preview.url}
              className="application-screenshot-preview application-screenshot-preview--pdf application-screenshot-preview--scaled"
              style={{ width: `${zoom}%`, height: `${Math.max(40, Math.round(70 * zoom / 100))}vh` }}
            />
          )}
        </div>
      ) : null}
      {note ? <Text type="secondary" style={{ display: "block", marginTop: 8 }}>{note}</Text> : null}
      {manager && mistakesOpen ? (
        <div style={{ marginTop: 12 }}>
          <Text strong>Screenshot review feedback</Text>
          <Input.TextArea
            rows={4}
            maxLength={2000}
            showCount
            style={{ marginTop: 8 }}
            value={draftFeedback}
            onChange={(event) => setDraftFeedback(event.target.value)}
            placeholder="Describe what is wrong or missing in the confirmation screenshot…"
            disabled={saving}
          />
          {error ? <ErrorState message={error} /> : null}
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" loading={saving} disabled={!draftDirty} onClick={() => saveFeedback(draftFeedback, { advance: true, reviewStatus: "HAS_MISTAKES" })}>Save feedback</Button>
            <Button disabled={saving} onClick={() => { setMistakesOpen(false); setDraftFeedback(application?.screenshot_feedback || ""); }}>Cancel</Button>
          </Space>
        </div>
      ) : null}
    </Modal>
  );
}
