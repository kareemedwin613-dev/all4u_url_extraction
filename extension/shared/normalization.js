const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingid", "ref"]);

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function hostnameFromUrl(value) {
  const normalized = normalizeUrl(value);
  return normalized ? new URL(normalized).hostname.replace(/^www\./, "") : "";
}
