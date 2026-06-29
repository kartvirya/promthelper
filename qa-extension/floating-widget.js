// floating-widget.js — on-page FAB + slide-in panel (accessibility-style UX)

const WIDGET_HOST_ID = "__qaSnapWidgetHost";
const FAB_POS_KEY = "qaSnapFabPosition";

let widgetHost = null;
let shadowRoot = null;
let fabEl = null;
let panelEl = null;
let backdropEl = null;
let iframeEl = null;
let panelOpen = false;
let widgetHidden = false;
let dragState = null;

function isBlockedPage() {
  const p = location.protocol;
  return (
    p === "chrome:" ||
    p === "chrome-extension:" ||
    p === "edge:" ||
    p === "about:" ||
    p === "moz-extension:"
  );
}

function isEnabled(settings) {
  return settings?.floatingButtonEnabled !== false;
}

async function getSettings() {
  const data = await chrome.storage.local.get("qaSnapSettings");
  return data.qaSnapSettings || {};
}

function applyFabPosition(fab, pos) {
  if (!fab || !pos) return;
  fab.style.bottom = "auto";
  fab.style.right = "auto";
  fab.style.left = `${pos.x}px`;
  fab.style.top = `${pos.y}px`;
}

function clampFabPosition(x, y, fab) {
  const margin = 8;
  const w = fab.offsetWidth || 52;
  const h = fab.offsetHeight || 52;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY)
  };
}

async function saveFabPosition(x, y) {
  await chrome.storage.local.set({ [FAB_POS_KEY]: { x, y } });
}

function setWidgetVisible(visible) {
  widgetHidden = !visible;
  if (widgetHost) widgetHost.style.display = visible ? "" : "none";
  if (fabEl && visible && !panelOpen) fabEl.style.display = "";
}

function openPanel() {
  if (!panelEl || !backdropEl) return;
  panelOpen = true;
  panelEl.classList.add("open");
  backdropEl.classList.add("open");
  fabEl?.setAttribute("aria-expanded", "true");
  if (fabEl) fabEl.style.display = "none";
  if (!iframeEl.src) {
    iframeEl.src = chrome.runtime.getURL("popup.html?embed=1");
    iframeEl.addEventListener("load", sizePanelFrame, { once: false });
  }
  sizePanelFrame();
}

function closePanel() {
  if (!panelEl || !backdropEl) return;
  panelOpen = false;
  panelEl.classList.remove("open");
  backdropEl.classList.remove("open");
  fabEl?.setAttribute("aria-expanded", "false");
  if (fabEl && !widgetHidden) fabEl.style.display = "";
}

function sizePanelFrame() {
  if (!iframeEl || !panelEl) return;
  const header = panelEl.querySelector(".panel-header");
  const headerH = header?.offsetHeight || 48;
  iframeEl.style.height = `${Math.max(200, window.innerHeight - headerH)}px`;
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

function onFabPointerDown(e) {
  if (!fabEl) return;
  e.preventDefault();
  const rect = fabEl.getBoundingClientRect();
  dragState = {
    pointerId: e.pointerId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    moved: false,
    startX: e.clientX,
    startY: e.clientY
  };
  fabEl.setPointerCapture(e.pointerId);
}

function onFabPointerMove(e) {
  if (!dragState || dragState.pointerId !== e.pointerId || !fabEl) return;
  const dx = Math.abs(e.clientX - dragState.startX);
  const dy = Math.abs(e.clientY - dragState.startY);
  if (dx > 4 || dy > 4) dragState.moved = true;

  const pos = clampFabPosition(
    e.clientX - dragState.offsetX,
    e.clientY - dragState.offsetY,
    fabEl
  );
  applyFabPosition(fabEl, pos);
}

async function onFabPointerUp(e) {
  if (!dragState || dragState.pointerId !== e.pointerId || !fabEl) return;
  fabEl.releasePointerCapture(e.pointerId);

  const rect = fabEl.getBoundingClientRect();
  const pos = clampFabPosition(rect.left, rect.top, fabEl);
  applyFabPosition(fabEl, pos);
  await saveFabPosition(pos.x, pos.y);

  if (!dragState.moved) togglePanel();
  dragState = null;
}

function buildWidget() {
  if (document.getElementById(WIDGET_HOST_ID) || isBlockedPage()) return;

  widgetHost = document.createElement("div");
  widgetHost.id = WIDGET_HOST_ID;
  shadowRoot = widgetHost.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }

    .fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 52px;
      height: 52px;
      border: none;
      border-radius: 50%;
      cursor: grab;
      z-index: 2147483647;
      background: linear-gradient(135deg, #2d2a5e, #6c63ff);
      color: #fff;
      box-shadow: 0 4px 20px rgba(108, 99, 255, 0.45), 0 2px 8px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      touch-action: none;
    }
    .fab:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 28px rgba(108, 99, 255, 0.55), 0 3px 12px rgba(0,0,0,0.3);
    }
    .fab:active { cursor: grabbing; }
    .fab img {
      width: 28px;
      height: 28px;
      pointer-events: none;
      border-radius: 6px;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 17, 23, 0.45);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
      z-index: 2147483645;
    }
    .backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .panel {
      position: fixed;
      top: 0;
      right: 0;
      width: min(500px, 100vw);
      height: 100vh;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 2147483646;
      background: #0f1117;
      box-shadow: -8px 0 32px rgba(0,0,0,0.35);
      display: flex;
      flex-direction: column;
    }
    .panel.open { transform: translateX(0); }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: #1a1d27;
      border-bottom: 1px solid #2e3248;
      flex-shrink: 0;
      min-height: 48px;
    }
    .panel-title {
      font-size: 13px;
      font-weight: 700;
      color: #e8eaf0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-title-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #6c63ff;
      box-shadow: 0 0 8px #6c63ff;
    }
    .panel-close {
      border: none;
      background: #22263a;
      color: #e8eaf0;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .panel-close:hover { background: #2e3248; }

    .panel-body {
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
      background: #0f1117;
    }

    .panel-frame {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
      background: #0f1117;
      display: block;
    }
  `;

  backdropEl = document.createElement("div");
  backdropEl.className = "backdrop";
  backdropEl.addEventListener("click", closePanel);

  panelEl = document.createElement("div");
  panelEl.className = "panel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-label", "QA Snap");

  const header = document.createElement("div");
  header.className = "panel-header";
  header.innerHTML =
    '<div class="panel-title"><span class="panel-title-dot"></span>QA Snap</div>';
  const closeBtn = document.createElement("button");
  closeBtn.className = "panel-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close QA Snap");
  closeBtn.innerHTML = typeof iconHtml === "function" ? iconHtml("x", { size: 16 }) : "×";
  closeBtn.addEventListener("click", closePanel);
  header.appendChild(closeBtn);

  iframeEl = document.createElement("iframe");
  iframeEl.className = "panel-frame";
  iframeEl.title = "QA Snap bug reporter";

  const panelBody = document.createElement("div");
  panelBody.className = "panel-body";
  panelBody.appendChild(iframeEl);

  panelEl.append(header, panelBody);

  fabEl = document.createElement("button");
  fabEl.className = "fab";
  fabEl.type = "button";
  fabEl.setAttribute("aria-label", "Open QA Snap");
  fabEl.setAttribute("aria-expanded", "false");
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/icon48.png");
  icon.alt = "";
  fabEl.appendChild(icon);
  fabEl.addEventListener("pointerdown", onFabPointerDown);
  fabEl.addEventListener("pointermove", onFabPointerMove);
  fabEl.addEventListener("pointerup", onFabPointerUp);
  fabEl.addEventListener("pointercancel", onFabPointerUp);

  shadowRoot.append(style, backdropEl, panelEl, fabEl);
  document.documentElement.appendChild(widgetHost);

  window.addEventListener("resize", sizePanelFrame);

  chrome.storage.local.get(FAB_POS_KEY).then(data => {
    if (data[FAB_POS_KEY]) applyFabPosition(fabEl, data[FAB_POS_KEY]);
  });
}

function removeWidget() {
  closePanel();
  widgetHost?.remove();
  widgetHost = null;
  shadowRoot = null;
  fabEl = null;
  panelEl = null;
  backdropEl = null;
  iframeEl = null;
}

async function syncWidget() {
  const settings = await getSettings();
  if (!isEnabled(settings)) {
    removeWidget();
    return;
  }
  if (!widgetHost) buildWidget();
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && panelOpen) closePanel();
});

document.addEventListener("qa-snap-close-panel", () => closePanel());

window.addEventListener("message", e => {
  if (e.data?.source !== "qa-snap-panel") return;
  if (e.data.action === "hideWidget") setWidgetVisible(false);
  if (e.data.action === "showWidget") setWidgetVisible(true);
  if (e.data.action === "closePanel") closePanel();
  if (e.data.action === "openPanel") openPanel();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "setFloatingWidgetVisible") {
    setWidgetVisible(message.visible !== false);
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === "closeQaSnapPanel") {
    closePanel();
    sendResponse({ ok: true });
    return false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.qaSnapSettings) syncWidget();
});

syncWidget();
