import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const failure = code => Object.assign(Error(code), { code });
const MAX_BYTES = 5 * 1024 * 1024;

export function tilesFor(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 100_000_000) throw failure("SCREENSHOT_DIMENSIONS_UNSUPPORTED");
  const tileHeight = Math.max(1200, Math.round(1800 * width / 1800));
  const overlap = Math.round(tileHeight / 12), result = [];
  for (let top = 0; top < height; top += tileHeight - overlap) {
    result.push({ left: 0, top, width, height: Math.min(tileHeight, height - top) });
    if (top + tileHeight >= height) break;
  }
  if (result.length > 40) throw failure("SCREENSHOT_TOO_LONG");
  return result;
}

export async function downloadScreenshot(shot, origin, fetchImpl = fetch) {
  const url = new URL(shot.url), trusted = new URL(origin);
  if (url.origin !== trusted.origin || url.username || url.password || url.hash
    || !url.pathname.startsWith("/storage/v1/object/sign/application-screenshots/")
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw failure("SCREENSHOT_URL_INVALID");
  if (!["image/png", "image/jpeg", "image/webp"].includes(shot.mimeType)) throw failure("SCREENSHOT_FORMAT_UNSUPPORTED");
  if (shot.bytes > MAX_BYTES) throw failure("SCREENSHOT_TOO_LARGE");
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw failure("SCREENSHOT_DOWNLOAD_FAILED");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw failure("SCREENSHOT_TOO_LARGE");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_BYTES) throw failure("SCREENSHOT_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export async function prepareImages(item, fetchImpl = fetch) {
  const directory = await mkdtemp(join(tmpdir(), "application-screenshot-review-"));
  const cleanup = () => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  const paths = [], manifest = [];
  try {
    if (!item.source.screenshots.length || item.source.screenshots.length > 10) throw failure("SCREENSHOT_COUNT_UNSUPPORTED");
    for (const shot of item.source.screenshots) {
      const bytes = await downloadScreenshot(shot, item.storageOrigin, fetchImpl);
      const options = { limitInputPixels: 100_000_000, failOn: "error" };
      const meta = await sharp(bytes, options).metadata();
      if (!["png", "jpeg", "webp"].includes(meta.format) || (meta.pages || 1) !== 1 || (meta.orientation && meta.orientation !== 1)) throw failure("SCREENSHOT_FORMAT_UNSUPPORTED");
      for (const rect of tilesFor(meta.width, meta.height)) {
        if (paths.length >= 40) throw failure("SCREENSHOT_TOO_LONG");
        const path = join(directory, `tile-${paths.length + 1}.png`);
        await sharp(bytes, options).extract(rect).resize({ width: Math.min(rect.width, 1800), withoutEnlargement: true }).png().toFile(path);
        paths.push(path); manifest.push({ attachment: paths.length, screenshotId: shot.id, ...rect, originalHeight: meta.height });
      }
    }
    return { paths, manifest, cleanup };
  } catch (error) { await cleanup(); throw error.code ? error : failure("SCREENSHOT_DECODE_FAILED"); }
}
