#!/usr/bin/env node
/**
 * QA Snap local bridge — opens your chosen editor/AI agent at the project path
 * and delivers the bug report (HTML + markdown in .qa-snap/).
 *
 * Run: node local-bridge/server.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const {
  getEditorTarget,
  listEditorTargets,
  buildTargetDeeplink,
  applyTemplateRaw,
  resolveCliCommand
} = require("../editor-targets.js");

const PORT = Number(process.env.QA_SNAP_BRIDGE_PORT || 9314);
const HOST = process.env.QA_SNAP_BRIDGE_HOST || "127.0.0.1";
const BRIDGE_VERSION = 2;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function runDetached(cmd, args, cwd) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    cwd: cwd || undefined,
    shell: false
  });
  child.unref();
}

function openUrl(url) {
  if (process.platform === "darwin") {
    exec(`open ${JSON.stringify(url)}`);
  } else if (process.platform === "win32") {
    exec(`start "" ${JSON.stringify(url)}`);
  } else {
    exec(`xdg-open ${JSON.stringify(url)}`);
  }
}

function openTerminal(command, cwd) {
  const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (process.platform === "darwin") {
    exec(
      `osascript -e 'tell application "Terminal" to do script "cd ${JSON.stringify(cwd).slice(1, -1)} && ${escaped}"'`
    );
  } else if (process.platform === "win32") {
    exec(`start cmd /k "cd /d ${JSON.stringify(cwd).slice(1, -1)} && ${command}"`);
  } else {
    const script = `cd ${JSON.stringify(cwd)} && ${command}`;
    const candidates = [
      ["gnome-terminal", ["--", "bash", "-lc", script]],
      ["konsole", ["-e", "bash", "-lc", script]],
      ["xfce4-terminal", ["-e", `bash -lc ${JSON.stringify(script)}`]],
      ["xterm", ["-e", "bash", "-lc", script]]
    ];
    for (const [bin, args] of candidates) {
      try {
        runDetached(bin, args);
        return;
      } catch {
        /* try next */
      }
    }
    exec(`x-terminal-emulator -e bash -lc ${JSON.stringify(script)}`);
  }
}

function resolveSourceFile(projectPath, sourceLocation) {
  if (!sourceLocation) return null;
  const parts = sourceLocation.split(":");
  let filePart = parts[0];

  filePart = filePart
    .replace(/^webpack:\/\/[^/]+\//, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^.*\/src\//, "src/");

  if (filePart.startsWith("/")) filePart = filePart.slice(1);

  const candidates = [
    path.join(projectPath, filePart),
    path.join(projectPath, "src", path.basename(filePart)),
    path.join(projectPath, path.basename(filePart))
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return { file, line: parts[1] || "1" };
    }
  }
  return null;
}

function buildHtmlFromScreenshot(screenshotBase64, issue) {
  const comment = (issue?.comment || "").replace(/-->/g, "→");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>QA Snap Issue</title></head>
<body>
<!-- QA Snap legacy screenshot export -->
<!-- ${comment} -->
<img src="data:image/png;base64,${screenshotBase64}" alt="Issue screenshot" style="max-width:100%"/>
</body></html>`;
}

function writeIssueFiles(projectPath, issue, prompt, htmlContent, screenshotBase64) {
  const dir = path.join(projectPath, ".qa-snap");
  fs.mkdirSync(dir, { recursive: true });

  const htmlPath = path.join(dir, "latest.html");
  const mdPath = path.join(dir, "latest.md");
  const jsonPath = path.join(dir, "latest.json");
  const pngPath = path.join(dir, "latest.png");

  fs.writeFileSync(htmlPath, htmlContent, "utf8");
  fs.writeFileSync(mdPath, prompt, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(issue, null, 2), "utf8");
  if (screenshotBase64) {
    fs.writeFileSync(pngPath, Buffer.from(screenshotBase64, "base64"));
  }

  return { htmlPath, mdPath, jsonPath, pngPath, dir };
}

function resolveHtmlContent(payload) {
  const { htmlContent, screenshotBase64, issue } = payload;
  if (htmlContent?.trim()) return htmlContent.trim();
  if (screenshotBase64?.trim()) return buildHtmlFromScreenshot(screenshotBase64.trim(), issue);
  return null;
}

function parseCustomOpenArgs(template, projectPath) {
  if (!template?.trim()) return ["-n", projectPath];
  const raw = applyTemplateRaw(template.trim(), { projectPath });
  return raw.split(/\s+/).filter(Boolean);
}

function parseCustomFileArgs(template, file, line) {
  if (!template?.trim()) return ["-g", `${file}:${line}`];
  const raw = applyTemplateRaw(template.trim(), { file, line });
  return raw.split(/\s+/).filter(Boolean);
}

function deliverToTarget(targetId, opts) {
  const { projectPath, prompt, paths, sourceFile, custom = {} } = opts;
  const target = getEditorTarget(targetId, custom);
  const cli = resolveCliCommand(targetId, custom);
  const fileDelay = sourceFile ? 1200 : 0;
  const promptDelay = sourceFile ? 2200 : 1500;

  if (!target.skipOpenProject && cli) {
    const openArgs =
      targetId === "custom"
        ? parseCustomOpenArgs(custom.openArgs, projectPath)
        : target.openProjectArgs(projectPath);
    runDetached(cli, openArgs);
  }

  if (sourceFile && cli && target.openFileArgs) {
    setTimeout(() => {
      const fileArgs =
        targetId === "custom"
          ? parseCustomFileArgs(custom.fileArgs, sourceFile.file, sourceFile.line)
          : target.openFileArgs(sourceFile.file, sourceFile.line);
      runDetached(cli, fileArgs, projectPath);
    }, fileDelay);
  }

  setTimeout(() => {
    switch (target.promptDelivery) {
      case "deeplink": {
        const url = buildTargetDeeplink(targetId, prompt, projectPath, custom);
        if (url) openUrl(url);
        break;
      }
      case "terminal": {
        const cmd =
          targetId === "custom" && custom.terminalTemplate
            ? applyTemplateRaw(custom.terminalTemplate, { projectPath, prompt })
            : target.buildTerminalCommand?.(projectPath, paths, prompt, custom);
        if (cmd) openTerminal(cmd, projectPath);
        break;
      }
      case "cli-run": {
        let runSpec;
        if (targetId === "custom" && custom.runArgs) {
          const parts = applyTemplateRaw(custom.runArgs, { projectPath, prompt })
            .split(/\s+/)
            .filter(Boolean);
          runDetached(parts[0], parts.slice(1), projectPath);
          break;
        }
        runSpec = target.buildRunArgs?.(projectPath, paths, prompt, custom);
        if (Array.isArray(runSpec)) {
          runDetached(runSpec[0], runSpec.slice(1), projectPath);
        } else if (cli) {
          runDetached(cli, runSpec || [], projectPath);
        }
        break;
      }
      case "custom": {
        if (custom.deeplinkTemplate) {
          const url = buildTargetDeeplink("custom", prompt, projectPath, custom);
          if (url) openUrl(url);
        } else if (custom.terminalTemplate) {
          openTerminal(
            applyTemplateRaw(custom.terminalTemplate, { projectPath, prompt }),
            projectPath
          );
        } else if (custom.runArgs) {
          const parts = applyTemplateRaw(custom.runArgs, { projectPath, prompt })
            .split(/\s+/)
            .filter(Boolean);
          if (parts.length) runDetached(parts[0], parts.slice(1), projectPath);
        }
        break;
      }
      case "files-only":
      default:
        break;
    }
  }, promptDelay);
}

async function handleSendIssue(body) {
  const payload = JSON.parse(body);
  const {
    projectPath,
    issue,
    prompt,
    htmlContent,
    screenshotBase64,
    editorTarget = "cursor",
    custom = {}
  } = payload;

  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error(`Project path not found: ${projectPath || "(empty)"}`);
  }
  if (!prompt?.trim()) {
    throw new Error("Missing prompt text");
  }

  const resolvedHtml = resolveHtmlContent(payload);
  if (!resolvedHtml) {
    throw new Error(
      "Missing page HTML. Restart the bridge: node qa-extension/local-bridge/server.js"
    );
  }

  const resolved = path.resolve(projectPath);
  const paths = writeIssueFiles(
    resolved,
    issue,
    prompt.trim(),
    resolvedHtml,
    screenshotBase64?.trim() || null
  );
  const src = resolveSourceFile(resolved, issue?.elementContext?.sourceLocation);

  deliverToTarget(editorTarget, {
    projectPath: resolved,
    prompt,
    paths,
    sourceFile: src,
    custom
  });

  const target = getEditorTarget(editorTarget, custom);
  return {
    ok: true,
    projectPath: resolved,
    editorTarget,
    editorLabel: target.label,
    sourceFile: src?.file || null
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, port: PORT, version: BRIDGE_VERSION, format: "html" }));
    }

    if (req.method === "GET" && req.url === "/targets") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ targets: listEditorTargets() }));
    }

    if (req.method === "POST" && req.url === "/send-issue") {
      const body = await readBody(req);
      const result = await handleSendIssue(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QA Snap bridge listening on http://${HOST}:${PORT}`);
  console.log("Supported targets:", listEditorTargets().map(t => t.label).join(", "));
});
