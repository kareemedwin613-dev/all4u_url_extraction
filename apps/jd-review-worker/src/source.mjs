import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { parseHTML } from "linkedom";

const blocked = new BlockList();
for (const [ip, bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]]) blocked.addSubnet(ip,bits,"ipv4");
export function publicAddress(address) {
  if (isIP(address) === 4) return !blocked.check(address,"ipv4");
  // Only global unicast; exclude transition, documentation and special-use ranges.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^(2001:|2002:|3fff:)/i.test(address);
}
export function validateSourceUrl(value) {
  const url = new URL(value);
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80","443"].includes(url.port))) throw Error("SOURCE_URL_UNSAFE");
  return url;
}
async function requestPage(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await new Promise((accept,reject) => {
    const abort = () => reject(Object.assign(Error("SOURCE_TIMEOUT"),{name:"TimeoutError"}));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort",abort,{once:true});
    lookup(hostname,{all:true}).then(accept,reject).finally(()=>signal.removeEventListener("abort",abort));
  });
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw Error("SOURCE_URL_UNSAFE");
  if (signal.aborted) throw Error("SOURCE_TIMEOUT");
  return new Promise((accept,reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, {
      signal, headers: { "User-Agent": "JDReview/1.0", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
      // Pin the validated address: redirects are resolved and checked separately.
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    }, response => {
      const chunks = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > 2_000_000) req.destroy(Error("SOURCE_TOO_LARGE")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => accept({ status: response.statusCode, headers: response.headers, html: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
  });
}
const normalize = text => String(text || "").replace(/\s+/g," ").trim();
export function extractSource({ status, headers = {}, html }, url) {
  const { document } = parseHTML(html);
  const jobs = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if ([value["@type"]].flat().includes("JobPosting")) jobs.push(value);
    if (value["@graph"]) visit(value["@graph"]);
  };
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(node.textContent)); } catch { /* Ignore broken metadata; visible text remains available. */ } }
  for (const node of document.querySelectorAll("script,style,noscript,svg,nav,footer")) node.remove();
  const text = normalize(document.body?.textContent || document.documentElement?.textContent);
  if (/captcha|verify (?:that )?you are human|access denied|checking your browser|just a moment|enable javascript and cookies/i.test(text)) return { attention: "SOURCE_CHALLENGE", url };
  if ([404,410].includes(status)) return { expired: true, status, url };
  if (status !== 200 || (headers["content-type"] && !/html/i.test(headers["content-type"]))) return { attention: `SOURCE_HTTP_${status}`, url };
  if (text.length < 300 || text.length > 65000 || jobs.length > 1) return { attention: "SOURCE_INCOMPLETE_OR_AMBIGUOUS", url };
  return { text, jobPosting: jobs[0] || null, url, status };
}
export async function fetchSource(value, request = requestPage) {
  try {
    let url = validateSourceUrl(value);
    const signal = AbortSignal.timeout(25000);
    for (let hop = 0; hop < 4; hop++) {
      const page = await request(url, signal);
      if ([301,302,303,307,308].includes(page.status) && page.headers.location) { url = validateSourceUrl(new URL(page.headers.location,url).href); continue; }
      return extractSource(page,url.href);
    }
    return { attention: "SOURCE_REDIRECT_LIMIT" };
  } catch (error) {
    const attention = ["SOURCE_URL_UNSAFE","SOURCE_TOO_LARGE"].includes(error.message) ? error.message
      : ["AbortError","TimeoutError"].includes(error.name) || error.message === "SOURCE_TIMEOUT" ? "SOURCE_TIMEOUT"
        : ["ENOTFOUND","EAI_AGAIN"].includes(error.code) ? "SOURCE_DNS_FAILED"
          : /CERT|TLS|SSL/.test(error.code || "") ? "SOURCE_TLS_FAILED" : "SOURCE_FETCH_FAILED";
    return { attention };
  }
}
