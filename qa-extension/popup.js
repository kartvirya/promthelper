// popup.js — QA Snap full logic

// ── State ────────────────────────────────────────────
let issues = [];
let currentScreenshot = null;
let currentUrl = "";
let currentTitle = "";
let currentElementContext = null;

let activeTool = "pen";
let currentColor = "#ff4f6a";
let brushSize = 3;
let currentSeverity = "critical";
let isDrawing = false;
let startX, startY;
let strokes = [];
let undoPointer = -1;
let activeStroke = null;

let canvas = null;
let ctx = null;
let bgImage = null;

// ── Init ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  canvas = document.getElementById("drawCanvas");
  ctx = canvas?.getContext("2d") || null;

  await loadIssues();
  await loadSettings();
  await loadElementContext();
  await fetchTabInfo();
  setupTabs();
  setupCapture();
  setupToolbar();
  setupCanvas();
  setupExport();
  setupIntegrations();
  setupElementPicker();
  renderIssuesList();
  updateStats();
});

async function fetchTabInfo() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: "getTabInfo" });
    if (resp) {
      currentUrl = resp.url || "";
      currentTitle = resp.title || "";
      document.getElementById("currentUrl").textContent = currentUrl || "Unknown URL";
    }
  } catch (e) {
    document.getElementById("currentUrl").textContent = "Could not read URL";
  }
}

// ── Storage ───────────────────────────────────────────
async function loadIssues() {
  const data = await chrome.storage.local.get("qaIssues");
  issues = data.qaIssues || [];
  document.getElementById("issueCount").textContent = issues.length;
}

async function saveIssues() {
  await chrome.storage.local.set({ qaIssues: issues });
  document.getElementById("issueCount").textContent = issues.length;
}

// ── Tabs ──────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "issues") renderIssuesList();
      if (btn.dataset.tab === "export") updateStats();
    });
  });
}

// ── Screenshot capture ────────────────────────────────
function setupCapture() {
  document.getElementById("btnCapture")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnCapture");
    btn.disabled = true;
    btn.textContent = "Capturing…";

    try {
      const info = await chrome.runtime.sendMessage({ action: "getTabInfo" });
      currentUrl = info?.url || currentUrl;
      currentTitle = info?.title || currentTitle;
      document.getElementById("currentUrl").textContent = currentUrl;

      const resp = await chrome.runtime.sendMessage({ action: "captureTab" });
      if (resp?.error) {
        showToast("❌ " + resp.error);
        return;
      }
      currentScreenshot = resp.dataUrl;
      loadImageToCanvas(currentScreenshot);
      document.getElementById("editorWrap").classList.add("visible");
    } catch (e) {
      showToast("❌ Capture failed");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "<span>📷</span> Capture Screenshot (optional)";
    }
  });
}

function getAnnotatedScreenshot() {
  if (!canvas || !ctx || !bgImage || canvas.width < 1 || canvas.height < 1) return "";
  try {
    return canvas.toDataURL("image/png", 1.0);
  } catch {
    return "";
  }
}

function buildIssueFromForm({ includeScreenshot = false } = {}) {
  const comment = document.getElementById("commentInput").value.trim();
  return {
    num: issues.length + 1,
    url: currentUrl,
    title: currentTitle,
    comment,
    severity: currentSeverity,
    screenshot: includeScreenshot ? getAnnotatedScreenshot() : "",
    elementContext: currentElementContext,
    timestamp: new Date().toISOString()
  };
}

function loadImageToCanvas(dataUrl) {
  if (!canvas || !ctx) return;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    bgImage = img;
    strokes = [];
    undoPointer = -1;
    activeStroke = null;
  };
  img.src = dataUrl;
}

function displayScale() {
  if (!canvas) return 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return 1;
  return canvas.width / rect.width;
}

function scaledSize(size) {
  return size * displayScale();
}

// ── Toolbar setup ─────────────────────────────────────
function setupToolbar() {
  // Tools
  const toolMap = {
    toolPen: "pen", toolArrow: "arrow", toolRect: "rect",
    toolCircle: "circle", toolText: "text", toolEraser: "eraser"
  };
  Object.entries(toolMap).forEach(([id, tool]) => {
    document.getElementById(id).addEventListener("click", () => {
      activeTool = tool;
      document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
      document.getElementById(id).classList.add("active");
    });
  });

  // Brush size
  document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
  });

  // Colors
  document.querySelectorAll(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      currentColor = sw.dataset.color;
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
      sw.classList.add("active");
    });
  });

  // Undo
  document.getElementById("btnUndo").addEventListener("click", undo);

  // Clear drawings (keep bg)
  document.getElementById("btnClear").addEventListener("click", () => {
    strokes = [];
    undoPointer = -1;
    activeStroke = null;
    redrawCanvas();
  });

  // Severity
  document.querySelectorAll(".sev-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sev-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentSeverity = btn.dataset.sev;
    });
  });

  // Save issue
  document.getElementById("btnSave").addEventListener("click", () => saveIssue(false));
  document.getElementById("btnSendChat").addEventListener("click", sendCurrentToChat);
  document.getElementById("btnSendAgent").addEventListener("click", sendCurrentToCloudAgent);
}

// ── Canvas drawing ─────────────────────────────────────
function setupCanvas() {
  if (!canvas) return;
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", onUp);
  canvas.addEventListener("mouseleave", onUp);
}

function getPos(e) {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function onDown(e) {
  const { x, y } = getPos(e);
  if (activeTool === "text") {
    promptTextInput(x, y);
    return;
  }
  isDrawing = true;
  startX = x;
  startY = y;
  if (activeTool === "pen" || activeTool === "eraser") {
    activeStroke = {
      tool: activeTool,
      color: currentColor,
      lineWidth: scaledSize(activeTool === "eraser" ? brushSize * 3 : brushSize),
      points: [{ x, y }]
    };
  }
}

function onMove(e) {
  if (!isDrawing) return;
  const { x, y } = getPos(e);

  if (activeTool === "pen" || activeTool === "eraser") {
    const points = activeStroke.points;
    const prev = points[points.length - 1];
    points.push({ x, y });
    ctx.save();
    if (activeTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.strokeStyle = currentColor;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.lineWidth = activeStroke.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  } else {
    redrawCanvas();
    drawShape(activeTool, startX, startY, x, y, scaledSize(brushSize), currentColor);
  }
}

function onUp(e) {
  if (!isDrawing) return;
  isDrawing = false;
  const { x, y } = getPos(e);

  if (activeTool === "pen" || activeTool === "eraser") {
    if (activeStroke?.points.length) commitStroke(activeStroke);
    activeStroke = null;
    return;
  }

  commitStroke({
    tool: activeTool,
    color: currentColor,
    lineWidth: scaledSize(brushSize),
    x1: startX,
    y1: startY,
    x2: x,
    y2: y
  });
}

function commitStroke(stroke) {
  strokes = strokes.slice(0, undoPointer + 1);
  strokes.push(stroke);
  undoPointer++;
  redrawCanvas();
}

function redrawCanvas() {
  if (!ctx) return;
  redrawBg();
  for (let i = 0; i <= undoPointer; i++) {
    applyStroke(strokes[i]);
  }
}

function applyStroke(stroke) {
  if (stroke.tool === "pen" || stroke.tool === "eraser") {
    const points = stroke.points;
    if (!points?.length) return;
    ctx.save();
    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.strokeStyle = stroke.color;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.lineWidth = stroke.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (stroke.tool === "text") {
    ctx.save();
    ctx.font = `bold ${stroke.fontSize}px Segoe UI, sans-serif`;
    ctx.fillStyle = stroke.color;
    ctx.fillText(stroke.text, stroke.x, stroke.y);
    ctx.restore();
    return;
  }

  drawShape(stroke.tool, stroke.x1, stroke.y1, stroke.x2, stroke.y2, stroke.lineWidth, stroke.color);
}

function drawShape(tool, x1, y1, x2, y2, lineWidth, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "source-over";

  if (tool === "rect") {
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  } else if (tool === "circle") {
    const rx = (x2 - x1) / 2;
    const ry = (y2 - y1) / 2;
    ctx.beginPath();
    ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tool === "arrow") {
    drawArrow(x1, y1, x2, y2, lineWidth, color);
  }
  ctx.restore();
}

function drawArrow(x1, y1, x2, y2, lineWidth, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, lineWidth * 4);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function promptTextInput(x, y) {
  const text = prompt("Enter text annotation:");
  if (text) {
    commitStroke({
      tool: "text",
      color: currentColor,
      fontSize: scaledSize(Math.max(14, brushSize * 4)),
      text,
      x,
      y
    });
  }
}

function undo() {
  if (undoPointer < 0) return;
  undoPointer--;
  redrawCanvas();
}

function redrawBg() {
  if (!canvas || !ctx || !bgImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgImage, 0, 0);
}

// ── Save issue ────────────────────────────────────────
async function saveIssue(andSendToEditor = false) {
  const comment = document.getElementById("commentInput").value.trim();
  if (!comment) {
    showToast("⚠️ Please add a comment first");
    return null;
  }

  const screenshot = getAnnotatedScreenshot();
  if (!screenshot) {
    showToast("⚠️ Capture a screenshot first to save an annotated issue");
    return null;
  }

  const issue = {
    id: Date.now(),
    num: issues.length + 1,
    url: currentUrl,
    title: currentTitle,
    comment,
    severity: currentSeverity,
    screenshot,
    elementContext: currentElementContext,
    timestamp: new Date().toISOString()
  };
  issues.push(issue);
  await saveIssues();
  showToast("✅ Issue #" + issue.num + " saved!");
  document.getElementById("commentInput").value = "";
  document.getElementById("editorWrap").classList.remove("visible");
  document.getElementById("btnCapture").innerHTML = "<span>📷</span> Capture Screenshot (optional)";
  currentScreenshot = null;
  bgImage = null;

  if (andSendToEditor) {
    await sendToLocalEditor(issue);
  }
  return issue;
}

async function sendCurrentToChat() {
  const comment = document.getElementById("commentInput").value.trim();
  if (!comment) {
    showToast("⚠️ Please add a comment first");
    return;
  }
  await sendToLocalEditor(buildIssueFromForm({ includeScreenshot: false }));
}

async function sendCurrentToCloudAgent() {
  const comment = document.getElementById("commentInput").value.trim();
  if (!comment) {
    showToast("⚠️ Please add a comment first");
    return;
  }
  const screenshot = getAnnotatedScreenshot();
  if (!screenshot) {
    showToast("⚠️ Capture & annotate a screenshot first for Cloud Agent");
    return;
  }
  await sendToCloudAgent(buildIssueFromForm({ includeScreenshot: true }));
}

// ── Issues list ───────────────────────────────────────
function renderIssuesList() {
  const list = document.getElementById("issuesList");
  if (issues.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🐛</div><div>No issues captured yet.<br/>Go to Capture to get started.</div></div>`;
    return;
  }

  const target = typeof getEditorTarget === "function"
    ? getEditorTarget(settings.editorTarget || "cursor")
    : null;
  const showCloud = !!target?.supportsCloud;
  const targetLabel = target?.label || "Editor";

  list.innerHTML = issues.map(issue => `
    <div class="issue-card" id="card-${issue.id}">
      ${issue.screenshot
        ? `<img class="issue-img" src="${issue.screenshot}" alt="Issue screenshot"/>`
        : `<div class="issue-img" style="padding:24px;text-align:center;color:#7b80a0;font-size:12px">📄 HTML-only issue</div>`}
      <div class="issue-body">
        <div class="issue-meta">
          <span class="issue-num">#${issue.num} · ${formatTime(issue.timestamp)}</span>
          <span class="issue-sev sev-${issue.severity}">${issue.severity}</span>
        </div>
        <div class="issue-comment">${escHtml(issue.comment)}</div>
        <div class="issue-url">🔗 ${escHtml(issue.url)}</div>
        ${issue.elementContext?.selector ? `<div class="issue-url">🎯 ${escHtml(issue.elementContext.selector)}</div>` : ""}
        <div class="issue-actions">
          <button class="btn-cursor-sm" onclick="sendSavedIssueToChat(${issue.id})">💬 ${escHtml(targetLabel)}</button>
          ${showCloud ? `<button class="btn-cursor-sm" onclick="sendSavedIssueToAgent(${issue.id})">☁️ Agent</button>` : ""}
          <button class="btn-del" onclick="deleteIssue(${issue.id})">🗑 Delete</button>
        </div>
      </div>
    </div>
  `).join("");
}

window.deleteIssue = async function(id) {
  issues = issues.filter(i => i.id !== id);
  await saveIssues();
  renderIssuesList();
  updateStats();
};

window.sendSavedIssueToChat = async function(id) {
  const issue = issues.find(i => i.id === id);
  if (issue) await sendToLocalEditor(issue);
};

window.sendSavedIssueToAgent = async function(id) {
  const issue = issues.find(i => i.id === id);
  if (!issue?.screenshot) {
    showToast("⚠️ This issue has no screenshot for Cloud Agent");
    return;
  }
  if (issue) await sendToCloudAgent(issue);
};

// ── Editor / AI integrations ──────────────────────────
const DEFAULT_SETTINGS = {
  editorTarget: "cursor",
  projectPath: "",
  bridgeUrl: "http://127.0.0.1:9314",
  customCli: "",
  customOpenArgs: "-n {projectPath}",
  customFileArgs: "-g {file}:{line}",
  customDeeplink: "",
  customTerminal: "",
  customRunArgs: "",
  cursorApiKey: "",
  repoUrl: "",
  repoBranch: "main",
  modelId: "composer-2",
  continueThread: false,
  cursorAgentId: ""
};

let settings = { ...DEFAULT_SETTINGS };

function populateEditorTargetSelect() {
  const select = document.getElementById("editorTarget");
  if (!select || typeof listEditorTargets !== "function") return;

  select.innerHTML = "";
  let currentGroup = null;
  for (const t of listEditorTargets()) {
    if (t.group !== currentGroup) {
      currentGroup = t.group;
      const og = document.createElement("optgroup");
      og.label = currentGroup;
      select.appendChild(og);
    }
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    select.lastElementChild.appendChild(opt);
  }
}

function getCustomConfigFromForm() {
  return {
    cli: document.getElementById("customCli").value.trim(),
    openArgs: document.getElementById("customOpenArgs").value.trim(),
    fileArgs: document.getElementById("customFileArgs").value.trim(),
    deeplinkTemplate: document.getElementById("customDeeplink").value.trim(),
    terminalTemplate: document.getElementById("customTerminal").value.trim(),
    runArgs: document.getElementById("customRunArgs").value.trim()
  };
}

function updateIntegrationsUI() {
  const targetId = document.getElementById("editorTarget")?.value || settings.editorTarget || "cursor";
  const target = typeof getEditorTarget === "function"
    ? getEditorTarget(targetId)
    : { label: "Editor", description: "", supportsCloud: false };

  const customFields = document.getElementById("customTargetFields");
  if (customFields) {
    customFields.style.display = targetId === "custom" ? "block" : "none";
  }

  const hint = document.getElementById("targetHint");
  if (hint) hint.textContent = target.description || "";

  const infoBox = document.getElementById("targetInfoBox");
  if (infoBox) {
    infoBox.innerHTML =
      `<strong>${escHtml(target.label)}</strong> — ${escHtml(target.description || "")}` +
      `<br/><br/>Run once: <code style="color:var(--accent)">node local-bridge/server.js</code>`;
  }

  const cloudSection = document.getElementById("cloudAgentSection");
  if (cloudSection) {
    cloudSection.style.display = target.supportsCloud ? "block" : "none";
  }

  const chatBtn = document.getElementById("btnSendChat");
  const agentBtn = document.getElementById("btnSendAgent");
  if (chatBtn) chatBtn.textContent = `💬 Send to ${target.label}`;
  if (agentBtn) {
    agentBtn.classList.toggle("hidden", !target.supportsCloud);
    if (target.supportsCloud) agentBtn.textContent = "☁️ Cursor Cloud Agent";
  }
}

function applySettingsToForm() {
  const editorTarget = document.getElementById("editorTarget");
  if (editorTarget) editorTarget.value = settings.editorTarget || "cursor";

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("projectPath", settings.projectPath || "");
  setVal("bridgeUrl", settings.bridgeUrl || "http://127.0.0.1:9314");
  setVal("customCli", settings.customCli || "");
  setVal("customOpenArgs", settings.customOpenArgs || "-n {projectPath}");
  setVal("customFileArgs", settings.customFileArgs || "-g {file}:{line}");
  setVal("customDeeplink", settings.customDeeplink || "");
  setVal("customTerminal", settings.customTerminal || "");
  setVal("customRunArgs", settings.customRunArgs || "");
  setVal("cursorApiKey", settings.cursorApiKey || "");
  setVal("repoUrl", settings.repoUrl || "");
  setVal("repoBranch", settings.repoBranch || "main");
  setVal("modelId", settings.modelId || "composer-2");
  setVal("cursorAgentId", settings.cursorAgentId || "");

  const continueThread = document.getElementById("continueThread");
  if (continueThread) continueThread.checked = !!settings.continueThread;

  const agentIdGroup = document.getElementById("agentIdGroup");
  if (agentIdGroup) {
    agentIdGroup.style.display = settings.cursorAgentId ? "flex" : "none";
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get("qaSnapSettings");
  settings = { ...DEFAULT_SETTINGS, ...(data.qaSnapSettings || {}) };
  populateEditorTargetSelect();
  applySettingsToForm();
  updateIntegrationsUI();
}

async function persistSettings() {
  await chrome.storage.local.set({ qaSnapSettings: settings });
}

function readSettingsFromForm() {
  settings = {
    editorTarget: document.getElementById("editorTarget").value || "cursor",
    projectPath: document.getElementById("projectPath").value.trim(),
    bridgeUrl: document.getElementById("bridgeUrl").value.trim() || "http://127.0.0.1:9314",
    customCli: document.getElementById("customCli").value.trim(),
    customOpenArgs: document.getElementById("customOpenArgs").value.trim(),
    customFileArgs: document.getElementById("customFileArgs").value.trim(),
    customDeeplink: document.getElementById("customDeeplink").value.trim(),
    customTerminal: document.getElementById("customTerminal").value.trim(),
    customRunArgs: document.getElementById("customRunArgs").value.trim(),
    cursorApiKey: document.getElementById("cursorApiKey").value.trim(),
    repoUrl: document.getElementById("repoUrl").value.trim(),
    repoBranch: document.getElementById("repoBranch").value.trim() || "main",
    modelId: document.getElementById("modelId").value.trim() || "composer-2",
    continueThread: document.getElementById("continueThread").checked,
    cursorAgentId: document.getElementById("cursorAgentId").value.trim()
  };
}

function setupIntegrations() {
  document.getElementById("editorTarget")?.addEventListener("change", async () => {
    readSettingsFromForm();
    updateIntegrationsUI();
    renderIssuesList();
    await persistSettings();
  });

  document.getElementById("btnSaveSettings").addEventListener("click", async () => {
    readSettingsFromForm();
    await persistSettings();
    applySettingsToForm();
    updateIntegrationsUI();
    showToast("💾 Settings saved");
  });

  document.getElementById("btnTestBridge").addEventListener("click", async () => {
    readSettingsFromForm();
    const base = settings.bridgeUrl.replace(/\/$/, "");
    showToast("🔌 Testing bridge…");
    try {
      const resp = await fetch(`${base}/health`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.ok) throw new Error("Bridge unhealthy");
      if (data.version && data.version < 2) {
        showToast("⚠️ Old bridge — restart: node local-bridge/server.js");
        return;
      }
      showToast("✅ Bridge connected (HTML mode)");
    } catch {
      showToast("❌ Bridge offline — run: node local-bridge/server.js");
    }
  });

  document.getElementById("btnVerifyKey").addEventListener("click", async () => {
    const key = document.getElementById("cursorApiKey").value.trim();
    if (!key) {
      showToast("⚠️ Enter your API key first");
      return;
    }
    showToast("🔑 Verifying…");
    try {
      const resp = await chrome.runtime.sendMessage({ action: "verifyCursorKey", apiKey: key });
      if (resp.error) throw new Error(resp.error);
      showToast("✅ API key valid");
    } catch (e) {
      showToast("❌ " + e.message);
    }
  });

  document.getElementById("btnNewThread").addEventListener("click", async () => {
    settings.cursorAgentId = "";
    document.getElementById("cursorAgentId").value = "";
    document.getElementById("agentIdGroup").style.display = "none";
    await persistSettings();
    showToast("🔄 New Cursor thread — next send creates a fresh agent");
  });

  document.getElementById("continueThread").addEventListener("change", () => {
    document.getElementById("agentIdGroup").style.display =
      document.getElementById("continueThread").checked ? "flex" : "none";
  });
}

function setupElementPicker() {
  document.getElementById("btnPickElement").addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        showToast("❌ Can't pick elements on this page");
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { action: "startElementPicker" });
      showToast("🎯 Click an element on the page");
      window.close();
    } catch {
      showToast("❌ Reload the page and try again");
    }
  });
}

async function loadElementContext() {
  const data = await chrome.storage.local.get("qaLastElement");
  currentElementContext = data.qaLastElement || null;
  updateElementContextUI();
}

function updateElementContextUI() {
  const btn = document.getElementById("btnPickElement");
  const info = document.getElementById("elementInfo");
  if (!currentElementContext) {
    btn.classList.remove("has-element");
    btn.textContent = "🎯 Pick Element on Page (optional)";
    info.classList.remove("visible");
    info.innerHTML = "";
    return;
  }
  btn.classList.add("has-element");
  btn.textContent = "🎯 Element selected — click to re-pick";
  info.classList.add("visible");
  const ec = currentElementContext;
  let html = `<strong>Element:</strong> <code>${escHtml(ec.selector)}</code>`;
  if (ec.reactComponents?.length) {
    html += `<br/><strong>Components:</strong> ${escHtml(ec.reactComponents.join(" → "))}`;
  }
  if (ec.sourceLocation) {
    html += `<br/><strong>Source:</strong> <code>${escHtml(ec.sourceLocation)}</code>`;
  }
  info.innerHTML = html;
}

async function prepareImageForApi(dataUrl) {
  const MAX_BYTES = 14 * 1024 * 1024;
  let base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  let byteSize = Math.ceil(base64.length * 0.75);

  if (byteSize <= MAX_BYTES) {
    return { apiImageBase64: base64, apiMimeType: "image/png" };
  }

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  for (let scale = 0.85; scale >= 0.35; scale -= 0.1) {
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    base64 = c.toDataURL("image/png", 1.0).split(",")[1];
    byteSize = Math.ceil(base64.length * 0.75);
    if (byteSize <= MAX_BYTES) {
      return { apiImageBase64: base64, apiMimeType: "image/png" };
    }
  }

  const c = document.createElement("canvas");
  c.width = Math.round(img.width * 0.35);
  c.height = Math.round(img.height * 0.35);
  const ctx2 = c.getContext("2d");
  ctx2.drawImage(img, 0, 0, c.width, c.height);
  base64 = c.toDataURL("image/jpeg", 0.92).split(",")[1];
  return { apiImageBase64: base64, apiMimeType: "image/jpeg" };
}

const DEEPLINK_MAX = 7800;

async function capturePageHtmlForIssue() {
  const resp = await chrome.runtime.sendMessage({ action: "capturePageHtml" });
  if (resp?.error) {
    showToast("⚠️ " + resp.error);
    return null;
  }
  return resp;
}

async function sendToLocalEditor(issue) {
  readSettingsFromForm();
  const target = typeof getEditorTarget === "function"
    ? getEditorTarget(settings.editorTarget)
    : { label: "Editor" };

  if (!settings.projectPath) {
    showToast("⚠️ Set project path in 🤖 AI / Editor tab");
    document.querySelector('[data-tab="integrations"]')?.click();
    return;
  }

  const btn = document.getElementById("btnSendChat");
  if (btn) btn.disabled = true;

  showToast("📄 Capturing page HTML…");

  const pageCapture = await capturePageHtmlForIssue();
  const htmlContent = buildIssueHtmlFile(issue, pageCapture?.html, pageCapture?.url);
  const prompt = buildLocalChatPrompt(issue, settings.projectPath, settings.editorTarget);
  const custom = getCustomConfigFromForm();
  const screenshotBase64 = getAnnotatedScreenshot()?.split(",")[1] || "";

  if (!prompt?.trim()) {
    showToast("⚠️ Could not build bug report prompt");
    if (btn) btn.disabled = false;
    return;
  }
  if (!htmlContent?.trim()) {
    showToast("⚠️ Could not capture page HTML — reload the page and try again");
    if (btn) btn.disabled = false;
    return;
  }

  try {
    const bridgeUrl = settings.bridgeUrl.replace(/\/$/, "");

    try {
      const resp = await fetch(`${bridgeUrl}/send-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: settings.projectPath,
          issue: {
            num: issue.num,
            url: issue.url,
            title: issue.title,
            comment: issue.comment,
            severity: issue.severity,
            timestamp: issue.timestamp,
            elementContext: issue.elementContext
          },
          prompt,
          htmlContent,
          screenshotBase64: screenshotBase64 || undefined,
          editorTarget: settings.editorTarget,
          custom
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data.error || `Bridge error (${resp.status})`;
        if (/screenshot/i.test(msg)) {
          throw new Error("Old bridge detected — restart: node qa-extension/local-bridge/server.js");
        }
        throw new Error(msg);
      }

      showToast(`✅ Opening ${data.editorLabel || target.label}…`);
      return;
    } catch (bridgeErr) {
      let fallbackPrompt = prompt;
      if (fallbackPrompt.length > DEEPLINK_MAX) {
        fallbackPrompt = fallbackPrompt.slice(0, DEEPLINK_MAX - 20) + "\n\n…[truncated]";
      }
      fallbackPrompt +=
        "\n\n📎 Start the bridge (`node local-bridge/server.js`) to auto-open your project and save `.qa-snap/latest.html`.";

      const deeplink = typeof buildTargetDeeplink === "function"
        ? buildTargetDeeplink(settings.editorTarget, fallbackPrompt, settings.projectPath, custom)
        : null;

      if (deeplink) {
        chrome.tabs.create({ url: deeplink });
        showToast(`💬 ${target.label} deeplink opened — start bridge for full workflow`);
      } else {
        showToast("❌ " + (bridgeErr.message || "Bridge offline"));
      }
      console.warn("Bridge failed:", bridgeErr.message);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** @deprecated use sendToLocalEditor */
async function sendToCursorChat(issue) {
  return sendToLocalEditor(issue);
}

async function sendToCloudAgent(issue) {
  readSettingsFromForm();
  if (!settings.cursorApiKey) {
    showToast("⚠️ Add Cursor API key in 🤖 AI / Editor tab");
    document.querySelector('[data-tab="integrations"]').click();
    return;
  }

  const btn = document.getElementById("btnSendAgent");
  if (btn) btn.disabled = true;
  showToast("☁️ Sending to Cloud Agent…");

  try {
    const imagePayload = await prepareImageForApi(issue.screenshot);
    const resp = await chrome.runtime.sendMessage({
      action: "sendToCursor",
      issue: { ...issue, ...imagePayload },
      settings
    });

    if (resp?.error) throw new Error(resp.error);

    if (resp.agentId) {
      settings.cursorAgentId = resp.agentId;
      document.getElementById("cursorAgentId").value = resp.agentId;
      document.getElementById("agentIdGroup").style.display = "flex";
      await persistSettings();
    }

    showToast("✅ Cloud Agent started!");
    if (resp.agentUrl) {
      chrome.tabs.create({ url: resp.agentUrl });
    }
  } catch (e) {
    showToast("❌ " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Export ────────────────────────────────────────────
function setupExport() {
  document.getElementById("btnZip").addEventListener("click", exportZip);
  document.getElementById("btnHtml").addEventListener("click", exportHtml);
  document.getElementById("btnJson").addEventListener("click", exportJson);
  document.getElementById("btnClearAll").addEventListener("click", async () => {
    if (confirm("Delete all " + issues.length + " issues? This cannot be undone.")) {
      issues = [];
      await saveIssues();
      renderIssuesList();
      updateStats();
      showToast("🗑 All issues cleared");
    }
  });
}

function updateStats() {
  document.getElementById("statTotal").textContent = issues.length;
  document.getElementById("statCritical").textContent = issues.filter(i => i.severity === "critical").length;
  document.getElementById("statMajor").textContent = issues.filter(i => i.severity === "major").length;
  document.getElementById("statMinor").textContent = issues.filter(i => i.severity === "minor").length;
}

// ── ZIP export (no external library needed — manual zip) ──
async function exportZip() {
  if (issues.length === 0) { showToast("No issues to export"); return; }
  showToast("📦 Building ZIP…");

  // Build HTML report inline
  const reportHtml = buildHtmlReport();
  // Build URLs text
  const urlsTxt = issues.map(i => `#${i.num} [${i.severity.toUpperCase()}] ${i.url}\n${i.comment}\n${i.timestamp}\n`).join("\n---\n\n");

  // Use JSZip via CDN via blob URL workaround — inject script dynamically
  const script = document.createElement("script");
  script.src = "jszip.min.js";
  document.head.appendChild(script);

  // We'll implement a lightweight zip creator in pure JS
  const zip = new SimpleZip();
  zip.addFile("report.html", reportHtml, "text/html");
  zip.addFile("urls.txt", urlsTxt, "text/plain");

  for (const issue of issues) {
    if (!issue.screenshot?.includes(",")) continue;
    const imgData = issue.screenshot.split(",")[1];
    zip.addBase64File(`screenshots/issue-${issue.num}-${issue.severity}.png`, imgData);
  }

  const blob = zip.generate();
  downloadBlob(blob, `qa-report-${dateStamp()}.zip`);
  showToast("✅ ZIP downloaded!");
}

function exportHtml() {
  if (issues.length === 0) { showToast("No issues to export"); return; }
  const html = buildHtmlReport();
  const blob = new Blob([html], { type: "text/html" });
  downloadBlob(blob, `qa-report-${dateStamp()}.html`);
  showToast("🌐 HTML Report downloaded!");
}

function exportJson() {
  if (issues.length === 0) { showToast("No issues to export"); return; }
  const data = issues.map(({ id, num, url, title, comment, severity, timestamp }) =>
    ({ id, num, url, title, comment, severity, timestamp })
  );
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `qa-report-${dateStamp()}.json`);
  showToast("{ } JSON downloaded!");
}

function buildHtmlReport() {
  const sevColor = { critical:"#ff4f6a", major:"#ff9444", minor:"#ffe044", info:"#6c63ff" };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QA Snap Report — ${dateStamp()}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;padding:24px}
  h1{font-size:28px;font-weight:800;margin-bottom:4px}
  .sub{color:#7b80a0;font-size:13px;margin-bottom:28px}
  .stats{display:flex;gap:16px;margin-bottom:32px;flex-wrap:wrap}
  .stat{background:#1a1d27;border:1px solid #2e3248;border-radius:10px;padding:16px 24px;text-align:center;min-width:100px}
  .stat-n{font-size:30px;font-weight:800;color:#6c63ff}
  .stat-l{font-size:11px;color:#7b80a0;margin-top:4px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:20px}
  .card{background:#1a1d27;border:1px solid #2e3248;border-radius:12px;overflow:hidden}
  .card img{width:100%;display:block;border-bottom:1px solid #2e3248}
  .card-body{padding:14px 16px}
  .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .num{font-size:12px;color:#7b80a0;font-weight:600}
  .sev{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px}
  .comment{font-size:13px;line-height:1.6;margin-bottom:8px}
  .url{font-size:11px;color:#7b80a0;word-break:break-all}
  .ts{font-size:10px;color:#4a4f6a;margin-top:6px}
</style>
</head>
<body>
<h1>🐛 QA Snap Report</h1>
<div class="sub">Generated ${new Date().toLocaleString()} · ${issues.length} issues</div>
<div class="stats">
  <div class="stat"><div class="stat-n">${issues.length}</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n" style="color:#ff4f6a">${issues.filter(i=>i.severity==="critical").length}</div><div class="stat-l">Critical</div></div>
  <div class="stat"><div class="stat-n" style="color:#ff9444">${issues.filter(i=>i.severity==="major").length}</div><div class="stat-l">Major</div></div>
  <div class="stat"><div class="stat-n" style="color:#ffe044">${issues.filter(i=>i.severity==="minor").length}</div><div class="stat-l">Minor</div></div>
  <div class="stat"><div class="stat-n" style="color:#6c63ff">${issues.filter(i=>i.severity==="info").length}</div><div class="stat-l">Info</div></div>
</div>
<div class="grid">
${issues.map(i=>`<div class="card">
  ${i.screenshot ? `<img src="${i.screenshot}" alt="Issue ${i.num}"/>` : `<div style="padding:32px;text-align:center;color:#7b80a0">📄 HTML-only issue</div>`}
  <div class="card-body">
    <div class="meta">
      <span class="num">#${i.num}</span>
      <span class="sev" style="background:${sevColor[i.severity]}22;color:${sevColor[i.severity]};border:1px solid ${sevColor[i.severity]}44">${i.severity}</span>
    </div>
    <div class="comment">${escHtml(i.comment)}</div>
    <div class="url">🔗 ${escHtml(i.url)}</div>
    <div class="ts">${new Date(i.timestamp).toLocaleString()}</div>
  </div>
</div>`).join("\n")}
</div>
</body></html>`;
}

// ── Simple ZIP implementation (no deps) ──────────────
class SimpleZip {
  constructor() { this.files = []; }

  addFile(name, content, mimeType) {
    const bytes = new TextEncoder().encode(content);
    this.files.push({ name, data: bytes });
  }

  addBase64File(name, b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    this.files.push({ name, data: bytes });
  }

  crc32(data) {
    const table = this._crcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  _crcTable() {
    if (this._table) return this._table;
    this._table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      this._table[n] = c;
    }
    return this._table;
  }

  generate() {
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of this.files) {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = this.crc32(file.data);
      const size = file.data.length;

      // Local file header
      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034B50, true);   // signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0, true);             // flags
      lv.setUint16(8, 0, true);             // compression: store
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0, true);            // mod date
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      parts.push(lh, file.data);

      // Central directory entry
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014B50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centralDir.push(cd);

      offset += lh.length + file.data.length;
    }

    const cdSize = centralDir.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.files.length, true);
    ev.setUint16(10, this.files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const all = [...parts, ...centralDir, eocd];
    const total = all.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of all) { out.set(a, pos); pos += a.length; }
    return new Blob([out], { type: "application/zip" });
  }
}

// ── Helpers ───────────────────────────────────────────
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
