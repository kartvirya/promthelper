// editor-targets.js — configurable IDE & AI agent integrations (browser + Node)

const EDITOR_TARGETS = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    group: "IDE",
    description: "Opens project in Cursor and pre-fills local chat via deeplink.",
    cli: "cursor",
    openProjectArgs: projectPath => ["-n", projectPath],
    openFileArgs: (file, line) => ["-g", `${file}:${line}`],
    promptDelivery: "deeplink",
    buildDeeplink: (prompt, _projectPath, _paths, _custom) =>
      `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`,
    supportsCloud: true
  },

  vscode: {
    id: "vscode",
    label: "VS Code + Copilot",
    group: "IDE",
    description: "Opens VS Code and pre-fills GitHub Copilot Chat (extension required).",
    cli: "code",
    openProjectArgs: projectPath => ["-n", projectPath],
    openFileArgs: (file, line) => ["-g", `${file}:${line}`],
    promptDelivery: "deeplink",
    buildDeeplink: prompt =>
      `vscode://GitHub.Copilot-Chat/chat?prompt=${encodeURIComponent(prompt)}`
  },

  "vscode-insiders": {
    id: "vscode-insiders",
    label: "VS Code Insiders + Copilot",
    group: "IDE",
    description: "Same as VS Code but uses the Insiders build.",
    cli: "code-insiders",
    openProjectArgs: projectPath => ["-n", projectPath],
    openFileArgs: (file, line) => ["-g", `${file}:${line}`],
    promptDelivery: "deeplink",
    buildDeeplink: prompt =>
      `vscode-insiders://GitHub.Copilot-Chat/chat?prompt=${encodeURIComponent(prompt)}`
  },

  "claude-vscode": {
    id: "claude-vscode",
    label: "Claude Code (VS Code ext)",
    group: "IDE",
    description: "Opens VS Code with the Anthropic Claude Code extension.",
    cli: "code",
    openProjectArgs: projectPath => ["-n", projectPath],
    openFileArgs: (file, line) => ["-g", `${file}:${line}`],
    promptDelivery: "deeplink",
    buildDeeplink: prompt =>
      `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`
  },

  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    group: "IDE",
    description: "Opens Windsurf Cascade with workspace + pre-filled prompt (press Enter to run).",
    cli: "windsurf",
    openProjectArgs: projectPath => [projectPath],
    promptDelivery: "deeplink",
    buildDeeplink: (prompt, projectPath) =>
      `windsurf://cascade/newChat?folder=${encodeURIComponent(projectPath)}&prompt=${encodeURIComponent(prompt)}`
  },

  zed: {
    id: "zed",
    label: "Zed",
    group: "IDE",
    description: "Opens the project folder — paste the prompt from `.qa-snap/latest.md` into Zed AI.",
    cli: "zed",
    openProjectArgs: projectPath => [projectPath],
    promptDelivery: "files-only"
  },

  "claude-code": {
    id: "claude-code",
    label: "Claude Code (CLI)",
    group: "CLI Agent",
    description: "Opens a terminal running Claude Code in your project with the bug report.",
    cli: "claude",
    promptDelivery: "terminal",
    buildTerminalCommand: (_projectPath, _paths, _prompt, custom) => {
      const cli = custom?.cli || "claude";
      return `${cli} "Fix the bug described in .qa-snap/latest.md. The page HTML snapshot is in .qa-snap/latest.html."`;
    },
    skipOpenProject: true
  },

  opencode: {
    id: "opencode",
    label: "OpenCode",
    group: "CLI Agent",
    description: "Runs `opencode run` with `.qa-snap/latest.html` and `.qa-snap/latest.md` attached.",
    cli: "opencode",
    promptDelivery: "cli-run",
    buildRunArgs: (_projectPath, _paths, _prompt, custom) => {
      const cli = custom?.cli || "opencode";
      return [
        cli,
        "run",
        "--file", ".qa-snap/latest.html",
        "--file", ".qa-snap/latest.md",
        "Fix the bug described in .qa-snap/latest.md using the page HTML snapshot."
      ];
    },
    skipOpenProject: true
  },

  codex: {
    id: "codex",
    label: "OpenAI Codex CLI",
    group: "CLI Agent",
    description: "Opens Codex via deeplink with the bug report pre-filled.",
    promptDelivery: "deeplink",
    buildDeeplink: prompt => `codex://new?prompt=${encodeURIComponent(prompt)}`,
    skipOpenProject: true
  },

  aider: {
    id: "aider",
    label: "Aider",
    group: "CLI Agent",
    description: "Opens a terminal with Aider pointed at the QA Snap report files.",
    cli: "aider",
    promptDelivery: "terminal",
    buildTerminalCommand: (_projectPath, _paths, _prompt, custom) => {
      const cli = custom?.cli || "aider";
      return `${cli} --read .qa-snap/latest.md --read .qa-snap/latest.html --message "Fix the bug described in latest.md"`;
    },
    skipOpenProject: true
  },

  custom: {
    id: "custom",
    label: "Custom…",
    group: "Custom",
    description: "Configure your own CLI command, deeplink, or terminal workflow.",
    promptDelivery: "custom"
  }
};

const EDITOR_TARGET_GROUPS = ["IDE", "CLI Agent", "Custom"];

function getEditorTarget(id, custom = {}) {
  if (id === "custom" || !EDITOR_TARGETS[id]) {
    return { ...EDITOR_TARGETS.custom, ...custom, id: "custom", label: custom.label || "Custom" };
  }
  return EDITOR_TARGETS[id];
}

function listEditorTargets() {
  return EDITOR_TARGET_GROUPS.flatMap(group =>
    Object.values(EDITOR_TARGETS)
      .filter(t => t.group === group)
      .map(t => ({ id: t.id, label: t.label, group: t.group, description: t.description }))
  );
}

function applyTemplate(template, vars) {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key] ?? "";
    return encodeURIComponent(val);
  });
}

function applyTemplateRaw(template, vars) {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

function buildTargetDeeplink(targetId, prompt, projectPath, custom = {}) {
  const target = getEditorTarget(targetId, custom);

  if (target.promptDelivery === "deeplink" && target.buildDeeplink) {
    return target.buildDeeplink(prompt, projectPath, null, custom);
  }

  if (custom.deeplinkTemplate) {
    return applyTemplateRaw(custom.deeplinkTemplate, {
      prompt: encodeURIComponent(prompt),
      projectPath: encodeURIComponent(projectPath)
    });
  }

  return null;
}

function resolveCliCommand(targetId, custom = {}) {
  if (targetId === "custom") return custom.cli || null;
  const target = EDITOR_TARGETS[targetId];
  return custom.cli || target?.cli || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EDITOR_TARGETS,
    EDITOR_TARGET_GROUPS,
    getEditorTarget,
    listEditorTargets,
    buildTargetDeeplink,
    applyTemplate,
    applyTemplateRaw,
    resolveCliCommand
  };
}
