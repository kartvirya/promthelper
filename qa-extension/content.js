// content.js — element picker + code location for QA Snap

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "startElementPicker") {
    startElementPicker();
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === "clearElementContext") {
    chrome.storage.local.remove("qaLastElement");
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === "capturePageHtml") {
    sendResponse(capturePageHtml());
    return false;
  }
});

const PAGE_HTML_MAX = 800_000;

function capturePageHtml() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll(
    "#__qaSnapOverlay, #__qaSnapHighlight, #__qaSnapWidgetHost"
  ).forEach(el => el.remove());

  let html = "<!DOCTYPE html>\n" + clone.outerHTML;
  const truncated = html.length > PAGE_HTML_MAX;
  if (truncated) {
    html = html.slice(0, PAGE_HTML_MAX) + "\n<!-- QA Snap: page HTML truncated -->";
  }

  return {
    html,
    url: location.href,
    title: document.title,
    truncated
  };
}

function startElementPicker() {
  document.dispatchEvent(new CustomEvent("qa-snap-close-panel"));
  if (document.getElementById("__qaSnapOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "__qaSnapOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(108,99,255,0.06);";

  const highlight = document.createElement("div");
  highlight.id = "__qaSnapHighlight";
  highlight.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6c63ff;background:rgba(108,99,255,0.12);border-radius:3px;transition:all 0.05s;";

  const hint = document.createElement("div");
  hint.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#1a1d27;color:#e8eaf0;padding:10px 18px;border-radius:8px;font:600 13px system-ui,sans-serif;" +
    "border:1px solid #6c63ff;box-shadow:0 4px 24px rgba(0,0,0,0.35);";
  hint.textContent = "Click the buggy element · Esc to cancel";

  document.body.append(highlight, hint, overlay);

  function cleanup() {
    overlay.remove();
    highlight.remove();
    hint.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") cleanup();
  }

  function onMove(e) {
    overlay.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = "auto";
    if (!el || el === overlay || el === highlight || el === hint || overlay.contains(el)) return;
    const r = el.getBoundingClientRect();
    highlight.style.top = r.top + "px";
    highlight.style.left = r.left + "px";
    highlight.style.width = r.width + "px";
    highlight.style.height = r.height + "px";
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    overlay.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    cleanup();
    if (!el || el === document.documentElement || el === document.body) return;

    const context = extractElementContext(el);
    chrome.storage.local.set({ qaLastElement: context });
    showPageToast("Element captured — reopen QA Snap", "circle-check");
  }

  overlay.addEventListener("mousemove", onMove, true);
  overlay.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

function extractElementContext(el) {
  const react = getReactInfo(el);
  return {
    selector: getCssPath(el),
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    className: typeof el.className === "string" ? el.className : null,
    text: (el.innerText || el.textContent || "").trim().slice(0, 200),
    outerHTML: el.outerHTML.slice(0, 600),
    rect: {
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height)
    },
    reactComponents: react.components,
    sourceLocation: react.sourceLocation,
    attributes: getKeyAttributes(el),
    pageUrl: location.href
  };
}

function getCssPath(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => c.tagName === node.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function getKeyAttributes(el) {
  const attrs = {};
  for (const name of ["data-testid", "data-test", "name", "type", "role", "aria-label", "href", "src"]) {
    const val = el.getAttribute(name);
    if (val) attrs[name] = val.slice(0, 120);
  }
  return attrs;
}

function getReactInfo(el) {
  const components = [];
  let sourceLocation = null;

  const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  if (!fiberKey) return { components, sourceLocation };

  let fiber = el[fiberKey];
  while (fiber) {
    if (fiber._debugSource && !sourceLocation) {
      const s = fiber._debugSource;
      sourceLocation = `${s.fileName}:${s.lineNumber}${s.columnNumber != null ? ":" + s.columnNumber : ""}`;
    }
    const type = fiber.type;
    if (typeof type === "function") {
      const name = type.displayName || type.name;
      if (name && name !== "Anonymous") components.unshift(name);
    } else if (typeof type === "object" && type && type.displayName) {
      components.unshift(type.displayName);
    }
    fiber = fiber.return;
  }

  return { components, sourceLocation };
}

function showPageToast(msg, iconName) {
  const t = document.createElement("div");
  t.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#00e5a0;color:#0f1117;padding:10px 20px;border-radius:20px;font:700 13px system-ui,sans-serif;" +
    "box-shadow:0 4px 20px rgba(0,0,0,0.3);";
  if (iconName && typeof iconHtml === "function") {
    t.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">${iconHtml(iconName, { size: 14 })}<span>${msg}</span></span>`;
  } else {
    t.textContent = msg;
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
