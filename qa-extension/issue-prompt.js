// issue-prompt.js — shared bug report text for Cursor chat & cloud agent

function buildIssuePrompt(issue) {
  const lines = [
    "# QA Bug Report",
    "",
    `**Severity:** ${issue.severity || "unknown"}`,
    `**Page URL:** ${issue.url || "N/A"}`,
    `**Page Title:** ${issue.title || "N/A"}`,
    `**Reported:** ${issue.timestamp || new Date().toISOString()}`,
    "",
    "## Issue Description",
    issue.comment || "(no description)",
    ""
  ];

  const ec = issue.elementContext;
  if (ec) {
    lines.push("## Element / Code Location");
    if (ec.selector) lines.push(`- **CSS Selector:** \`${ec.selector}\``);
    if (ec.reactComponents?.length) {
      lines.push(`- **Component Tree:** ${ec.reactComponents.join(" → ")}`);
    }
    if (ec.sourceLocation) lines.push(`- **Source File:** \`${ec.sourceLocation}\``);
    if (ec.tagName) lines.push(`- **HTML Tag:** \`<${ec.tagName}>\``);
    if (ec.text) lines.push(`- **Visible Text:** "${ec.text.slice(0, 120)}"`);
    const attrs = ec.attributes && Object.entries(ec.attributes);
    if (attrs?.length) {
      lines.push(
        `- **Attributes:** ${attrs.map(([k, v]) => `${k}="${v}"`).join(" ")}`
      );
    }
    if (ec.outerHTML) {
      lines.push("", "**HTML snippet:**", "```html", ec.outerHTML.slice(0, 400), "```");
    }
    lines.push("");
  }

  lines.push(
    "## Task",
    "Analyze the attached screenshot and the element/code context above.",
    "Find the relevant source code, explain the root cause, and fix the bug."
  );

  return lines.join("\n");
}

function buildIssueHtmlFile(issue, pageHtml, pageUrl) {
  const comment = (issue.comment || "").replace(/-->/g, "→");
  const header = [
    "<!-- QA Snap Issue Report -->",
    `<!-- Issue #${issue.num || "new"} | ${issue.severity || "unknown"} -->`,
    `<!-- Page: ${issue.url || pageUrl || "N/A"} -->`,
    `<!-- ${comment} -->`,
    ""
  ].join("\n");

  return (
    header +
    (pageHtml ||
      "<!DOCTYPE html><html><body><p>Could not capture page HTML. Reload the page and try again.</p></body></html>")
  );
}

function buildLocalChatPrompt(issue, projectPath, editorTargetId) {
  const target =
    typeof getEditorTarget === "function" ? getEditorTarget(editorTargetId || "cursor") : null;
  const toolName = target?.label || "your editor";

  const base = buildIssuePrompt(issue).replace(
    "Analyze the attached screenshot and the element/code context above.",
    "Analyze the page HTML in `.qa-snap/latest.html` and the element/code context above."
  );
  const header = [
    `# Project: ${projectPath}`,
    "",
    `Work in this local workspace using **${toolName}**. The captured page HTML is saved at \`.qa-snap/latest.html\` and the full report at \`.qa-snap/latest.md\`.`,
    ""
  ].join("\n");

  let prompt = header + base;
  const DEEPLINK_MAX = 7800;
  if (prompt.length > DEEPLINK_MAX) {
    prompt = prompt.slice(0, DEEPLINK_MAX - 20) + "\n\n…[truncated]";
  }
  return prompt;
}
