export function safeExternalUrl(value){try{const url=new URL(String(value||""));return ["http:","https:"].includes(url.protocol)?url.href:null;}catch{return null;}}

/** Open many http(s) links in one user gesture to reduce popup-blocker issues. */
export function openExternalUrls(urls = [], { limit = 25 } = {}) {
  const unique = [...new Set((Array.isArray(urls) ? urls : []).map((value) => safeExternalUrl(value)).filter(Boolean))];
  const capped = unique.slice(0, Math.max(0, Number(limit) || 0));
  let opened = 0;
  let blocked = 0;
  for (const url of capped) {
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    if (tab) opened += 1;
    else blocked += 1;
  }
  return {
    total: unique.length,
    attempted: capped.length,
    opened,
    blocked,
    skipped: Math.max(0, unique.length - capped.length),
  };
}
