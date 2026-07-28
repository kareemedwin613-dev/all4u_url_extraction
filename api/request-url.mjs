export function routedUrl(request) {
  const raw = Array.isArray(request.query?.__path) ? request.query.__path[0] : request.query?.__path;
  if (!raw || typeof raw !== "string" || !raw.startsWith("/")) return request.url;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query || {})) {
    if (key === "__path" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
  }
  const suffix = query.toString();
  return suffix ? `${raw}?${suffix}` : raw;
}
