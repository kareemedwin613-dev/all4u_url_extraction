// The on-page Autofill button. It lives in a closed shadow root so the job site's code cannot read or press it,
// acts only on real clicks and key presses, and only asks the extension to start Autofill: it never touches the
// job site's own buttons and never submits anything.
import { MESSAGE_TYPES } from "../shared/messages.js";

(() => {
  if (globalThis.__resumeJdPageLauncher) return;
  globalThis.__resumeJdPageLauncher = true;

  const BOLT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.2 2.3 4.6 13.1c-.4.5 0 1.2.6 1.2h5.3l-1.4 7.1c-.2.8.8 1.3 1.3.6l8.6-10.8c.4-.5 0-1.2-.6-1.2h-5.3l1.4-7.1c.2-.8-.8-1.3-1.3-.6Z"/></svg>`;
  const host = document.createElement("div");
  host.setAttribute("data-resume-jd-launcher", "");
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .wrap{position:relative;display:flex;justify-content:flex-end;animation:enter .45s cubic-bezier(.2,.9,.3,1.2) both}
    .pill{position:relative;display:flex;align-items:center;gap:10px;border:0;cursor:pointer;color:#fff;padding:8px 18px 8px 8px;border-radius:999px;
      background:linear-gradient(135deg,#2563eb 0%,#4f46e5 55%,#7c3aed 100%);box-shadow:0 10px 28px rgba(79,70,229,.45),0 2px 6px rgba(15,23,42,.18),inset 0 1px 0 rgba(255,255,255,.25);
      overflow:hidden;transition:transform .18s ease,box-shadow .18s ease;text-align:left}
    .pill:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(79,70,229,.55),0 3px 8px rgba(15,23,42,.2),inset 0 1px 0 rgba(255,255,255,.3)}
    .pill:active{transform:translateY(0) scale(.98)}
    .pill:focus-visible{outline:3px solid #c7d2fe;outline-offset:3px}
    .pill::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.35) 50%,transparent 70%);transform:translateX(-120%);animation:shine 1.6s .5s ease-out 2}
    .halo{position:absolute;inset:0;border-radius:999px;pointer-events:none;animation:halo 1.8s ease-out .3s 3}
    .icon{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);color:#fde68a;flex:none}
    .text{display:flex;flex-direction:column;line-height:1.15}
    .title{font-size:15px;font-weight:700;letter-spacing:.01em}
    .hint{font-size:11.5px;opacity:.9;margin-top:2px;display:flex;align-items:center;gap:5px;white-space:nowrap}
    .hint:empty{display:none}
    .dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.3)}
    .count{position:absolute;top:-6px;right:-4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#22c55e;color:#fff;font-size:12px;font-weight:700;display:none;place-items:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.2)}
    .count.on{display:grid}
    .hide{position:absolute;top:-8px;left:-8px;width:22px;height:22px;border-radius:50%;border:0;background:#fff;color:#4b5563;font-size:14px;line-height:22px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25);opacity:0;transform:scale(.7);transition:opacity .15s,transform .15s}
    .wrap:hover .hide,.hide:focus-visible{opacity:1;transform:scale(1)}
    .panel{position:absolute;right:0;bottom:64px;width:360px;max-height:460px;display:none;flex-direction:column;background:#fff;color:#1f2937;border-radius:14px;overflow:hidden;
      box-shadow:0 20px 50px rgba(15,23,42,.3),0 0 0 1px rgba(15,23,42,.06);animation:pop .22s ease-out both}
    .panel.open{display:flex}
    .head{display:flex;align-items:center;gap:10px;padding:12px 14px;color:#fff;background:linear-gradient(135deg,#2563eb,#4f46e5 55%,#7c3aed)}
    .head .icon{width:28px;height:28px}
    .head strong{flex:1;font-size:14px}
    .head button{border:0;background:rgba(255,255,255,.18);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:15px}
    .head button:hover{background:rgba(255,255,255,.3)}
    .go-row{display:flex;gap:8px;padding:12px 14px 8px}
    input{flex:1;min-width:0;border:1.5px solid #c7d2fe;border-radius:10px;padding:8px 10px;font-size:13.5px;color:#111827;background:#f8faff;outline:none;transition:border-color .15s,box-shadow .15s}
    input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.18);background:#fff}
    .go{border:0;border-radius:10px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-size:13.5px;font-weight:600;padding:8px 16px;cursor:pointer}
    .go:hover{filter:brightness(1.08)}
    .list{overflow:auto;padding:0 8px 10px}
    .label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;padding:10px 8px 6px}
    .label.match{color:#15803d}
    .item{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:0;background:none;border-radius:10px;padding:8px;cursor:pointer;color:#111827;line-height:1.35;transition:background .12s}
    .item:hover,.item:focus-visible{background:#eef2ff;outline:none}
    .item.match{background:#f0fdf4;box-shadow:inset 0 0 0 1px #bbf7d0;margin-bottom:4px}
    .item.match:hover{background:#dcfce7}
    .num{flex:none;font-size:12px;font-weight:700;color:#4338ca;background:#e0e7ff;border-radius:6px;padding:2px 7px;margin-top:1px}
    .item.match .num{color:#166534;background:#bbf7d0}
    .main{font-size:13px;font-weight:600}
    .sub{font-size:12px;color:#6b7280;font-weight:400}
    .msg{margin:0 14px 6px;padding:8px 10px;border-radius:8px;font-size:12px;color:#3730a3;background:#eef2ff}
    .msg.error{color:#991b1b;background:#fef2f2}
    .msg:empty{display:none}
    @keyframes enter{from{opacity:0;transform:translateY(16px) scale(.9)}to{opacity:1;transform:none}}
    @keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes shine{to{transform:translateX(120%)}}
    @keyframes halo{0%{box-shadow:0 0 0 0 rgba(99,102,241,.55)}100%{box-shadow:0 0 0 18px rgba(99,102,241,0)}}
    @media (prefers-reduced-motion:reduce){*,*::after{animation:none!important;transition:none!important}}
  </style>
  <div class="wrap">
    <div class="panel" role="dialog" aria-label="Autofill this page">
      <div class="head"><span class="icon">${BOLT}</span><strong>Autofill this page</strong><button type="button" class="close" aria-label="Close">×</button></div>
      <div class="go-row"><input inputmode="numeric" autocomplete="off" placeholder="Application number, e.g. 10482" aria-label="Application number"><button type="button" class="go">Go</button></div>
      <div class="msg"></div>
      <div class="list"></div>
    </div>
    <span class="halo"></span>
    <button type="button" class="pill open" aria-label="Autofill this page">
      <span class="icon">${BOLT}</span>
      <span class="text"><span class="title">Autofill</span><span class="hint"></span></span>
    </button>
    <span class="count" aria-hidden="true"></span>
    <button type="button" class="hide" aria-label="Hide for this page" title="Hide for this page">×</button>
  </div>`;

  const panel = root.querySelector(".panel"), list = root.querySelector(".list"), msg = root.querySelector(".msg");
  const input = root.querySelector("input"), hint = root.querySelector(".hint"), count = root.querySelector(".count");
  let busy = false;

  const say = (text, error = false) => { msg.textContent = text; msg.className = `msg${error ? " error" : ""}`; };
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload }).catch(() => ({ ok: false, error: { message: "The extension was updated or reloaded. Reload this page." } }));

  // The pill's second line: how many of the panel's Applications match this page.
  function showSummary(data) {
    const { likely = [], total = 0, panelOpen } = data || {};
    hint.replaceChildren();
    count.classList.toggle("on", likely.length > 0);
    count.textContent = likely.length > 9 ? "9+" : String(likely.length || "");
    if (likely.length) {
      const dot = document.createElement("span");
      dot.className = "dot";
      hint.append(dot, `${likely.length} ${likely.length === 1 ? "match" : "matches"} for this page`);
    } else if (!panelOpen) hint.textContent = "Open the panel to start";
    else if (total) hint.textContent = `Pick from ${total} application${total === 1 ? "" : "s"}`;
    else hint.textContent = "Type an application number";
  }

  function item(entry, match) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item${match ? " match" : ""}`;
    const num = document.createElement("span"), body = document.createElement("span"), main = document.createElement("div"), sub = document.createElement("div");
    num.className = "num"; num.textContent = entry.number ? `#${entry.number}` : "#?";
    main.className = "main"; main.textContent = [entry.company, entry.jobTitle].filter(Boolean).join(" · ") || "Application";
    sub.className = "sub"; sub.textContent = entry.candidate || "";
    body.append(main, sub);
    button.append(num, body);
    button.addEventListener("click", (event) => { if (event.isTrusted) start({ applicationId: entry.id }, entry.number); });
    return button;
  }

  function section(label, entries, match = false) {
    if (!entries.length) return;
    const heading = document.createElement("div");
    heading.className = `label${match ? " match" : ""}`; heading.textContent = label;
    list.append(heading, ...entries.map((entry) => item(entry, match)));
  }

  async function open() {
    panel.classList.add("open");
    list.replaceChildren();
    say("Loading your applications…");
    const response = await send(MESSAGE_TYPES.GET_PAGE_APPLICATIONS);
    if (!response?.ok) return say(response?.error?.message || "Your applications could not be loaded.", true);
    showSummary(response.data);
    const { likely = [], others = [], total = 0, panelOpen } = response.data || {};
    section(likely.length > 1 ? "✓ Matches this page — pick the profile" : "✓ Matches this page", likely, true);
    section("Showing in the panel", others);
    if (!panelOpen) say("Open the Resume JD Capture panel first: it runs Autofill.", true);
    else if (!total) say("Open My Applications in the panel, or type an application number.");
    else say(likely.length ? "" : "No application matches this page's address. Pick one or type its number.");
    input.focus();
  }

  function close() { panel.classList.remove("open"); list.replaceChildren(); }

  async function start(payload, number) {
    if (busy) return;
    busy = true;
    say(`Starting Autofill${number ? ` for #${number}` : ""}…`);
    const response = await send(MESSAGE_TYPES.START_PAGE_AUTOFILL, payload);
    busy = false;
    if (!response?.ok) return say(response?.error?.message || "Autofill could not start.", true);
    // Hand focus back to the page: search dropdowns only fill while the page has it.
    input.blur();
    close();
  }

  root.querySelector(".open").addEventListener("click", (event) => { if (!event.isTrusted) return; if (panel.classList.contains("open")) close(); else open(); });
  root.querySelector(".close").addEventListener("click", (event) => { if (event.isTrusted) close(); });
  root.querySelector(".hide").addEventListener("click", (event) => { if (event.isTrusted) host.remove(); });
  function goToNumber() {
    const number = Number(String(input.value).replace(/[^\d]/g, ""));
    if (!Number.isSafeInteger(number) || number < 1) return say("Enter an application number.", true);
    start({ applicationNumber: number }, number);
  }
  root.querySelector(".go").addEventListener("click", (event) => { if (event.isTrusted) goToNumber(); });
  input.addEventListener("keydown", (event) => { if (event.isTrusted && event.key === "Enter") { event.preventDefault(); goToNumber(); } });
  input.addEventListener("keydown", (event) => { if (event.isTrusted && event.key === "Escape") close(); });
  // Keep typing in the picker away from the job site's keyboard shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());

  (document.documentElement || document.body).append(host);
  send(MESSAGE_TYPES.GET_PAGE_APPLICATIONS).then((response) => { if (response?.ok) showSummary(response.data); });
})();
