// jira-api.js — Jira Cloud REST API helpers (loaded by background.js)

function normalizeJiraSiteUrl(url) {
  if (!url?.trim()) throw new Error("Jira site URL is required");
  let site = url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
  let parsed;
  try {
    parsed = new URL(site);
  } catch {
    throw new Error("Invalid Jira site URL");
  }
  if (!parsed.hostname.endsWith(".atlassian.net")) {
    throw new Error("Only Jira Cloud (*.atlassian.net) is supported");
  }
  return parsed.origin;
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function jiraAuthHeader(settings) {
  const email = settings.jiraEmail?.trim();
  const token = settings.jiraApiToken?.trim();
  if (!email || !token) throw new Error("Jira email and API token are required");
  return `Basic ${base64Encode(`${email}:${token}`)}`;
}

async function jiraRequest(settings, path, options = {}) {
  const base = normalizeJiraSiteUrl(settings.jiraSiteUrl);
  const headers = {
    Accept: "application/json",
    Authorization: jiraAuthHeader(settings),
    ...(options.headers || {})
  };

  const resp = await fetch(`${base}${path}`, { ...options, headers });
  const text = await resp.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!resp.ok) {
    const msg =
      data.errorMessages?.join("; ") ||
      data.errors?.message ||
      data.message ||
      (typeof data.error === "string" ? data.error : null) ||
      `Jira API error (${resp.status})`;
    throw new Error(msg);
  }

  return data;
}

function normalizePickerIssues(data) {
  const seen = new Set();
  const results = [];

  for (const section of data.sections || []) {
    for (const issue of section.issues || []) {
      const key = issue.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push({
        key,
        id: String(issue.id),
        summary: issue.summaryText || issue.summary || key,
        status: issue.statusName || issue.status || "",
        img: issue.img || null
      });
    }
  }

  return results;
}

function escapeJqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function mapSearchIssues(search) {
  return (search.issues || [])
    .map(issue => ({
      key: issue.key,
      id: String(issue.id),
      summary: issue.fields?.summary || issue.key || String(issue.id),
      status: issue.fields?.status?.name || "",
      img: null
    }))
    .filter(issue => issue.key);
}

async function jqlSearchIssues(settings, jql) {
  const body = {
    jql,
    maxResults: 25,
    fields: ["summary", "status"]
  };

  try {
    const search = await jiraRequest(settings, "/rest/api/3/search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const issues = mapSearchIssues(search);
    if (issues.length) return issues;
  } catch (err) {
    const msg = err?.message || "";
    if (/401|403/.test(msg)) throw err;
    /* try legacy search */
  }

  const search = await jiraRequest(settings, "/rest/api/3/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return mapSearchIssues(search);
}

function isIssueKey(value) {
  return /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value);
}

async function searchJiraIssues(settings, query) {
  const q = (query || "").trim();
  if (!q) return [];

  const projectKey = settings.jiraProjectKey?.trim();
  const projectClause = projectKey
    ? `project = "${escapeJqlString(projectKey)}"`
    : "";

  if (isIssueKey(q)) {
    try {
      const issue = await getJiraIssue(settings, q.toUpperCase());
      return [{
        key: issue.key,
        id: issue.id,
        summary: issue.summary,
        status: issue.status,
        img: null
      }];
    } catch {
      /* fall through to broader search */
    }
  }

  const params = new URLSearchParams({ query: q, showSubTasks: "true" });
  if (projectClause) params.set("currentJQL", projectClause);

  try {
    const data = await jiraRequest(settings, `/rest/api/3/issue/picker?${params}`);
    const issues = normalizePickerIssues(data);
    if (issues.length) return issues.slice(0, 25);
  } catch (err) {
    const msg = err?.message || "";
    if (/401|403/.test(msg)) throw err;
  }

  const jqlParts = [];
  if (projectClause) jqlParts.push(projectClause);

  if (isIssueKey(q)) {
    jqlParts.push(`key = "${q.toUpperCase()}"`);
  } else {
    const term = escapeJqlString(q);
    jqlParts.push(`(summary ~ "${term}" OR description ~ "${term}" OR text ~ "${term}")`);
  }
  jqlParts.push("ORDER BY updated DESC");

  return jqlSearchIssues(settings, jqlParts.join(" AND "));
}

async function getJiraIssue(settings, issueKey) {
  const data = await jiraRequest(
    settings,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status`
  );
  const base = normalizeJiraSiteUrl(settings.jiraSiteUrl);
  return {
    key: data.key,
    id: String(data.id),
    summary: data.fields?.summary || data.key,
    status: data.fields?.status?.name || "",
    url: `${base}/browse/${data.key}`
  };
}

async function verifyJiraCredentials(settings) {
  const me = await jiraRequest(settings, "/rest/api/3/myself");
  if (!me || typeof me !== "object") {
    throw new Error("Unexpected response from Jira");
  }
  return {
    displayName: me.displayName || me.name || settings.jiraEmail,
    emailAddress: me.emailAddress || settings.jiraEmail,
    accountId: me.accountId || null
  };
}

function adfParagraph(text) {
  return {
    type: "paragraph",
    content: [{ type: "text", text: String(text) }]
  };
}

function buildQaReportAdf(qaIssue, { forComment = false } = {}) {
  const lines = [
    "QA Snap bug report",
    "",
    `Severity: ${qaIssue.severity || "unknown"}`,
    `Page: ${qaIssue.url || "N/A"}`,
    `Title: ${qaIssue.title || "N/A"}`,
    "",
    "Description:",
    qaIssue.comment || "(no description)"
  ];

  const ec = qaIssue.elementContext;
  if (ec) {
    lines.push("", "Element / code context:");
    if (ec.selector) lines.push(`Selector: ${ec.selector}`);
    if (ec.sourceLocation) lines.push(`Source: ${ec.sourceLocation}`);
    if (ec.reactComponents?.length) lines.push(`Components: ${ec.reactComponents.join(" → ")}`);
  }

  if (qaIssue.jiraContext?.key) {
    lines.push("", `Linked from Jira: ${qaIssue.jiraContext.key}`);
  }

  if (forComment) {
    lines.push("", "Attachments: qa-snap-report.html" + (qaIssue.screenshot ? ", qa-snap-screenshot.png" : ""));
  }

  return {
    type: "doc",
    version: 1,
    content: lines.filter(l => l !== "").map(adfParagraph)
  };
}

function buildJiraAdfBody(qaIssue) {
  return buildQaReportAdf(qaIssue, { forComment: true });
}

function severityToJiraPriority(severity) {
  const map = {
    critical: "Highest",
    major: "High",
    minor: "Medium",
    info: "Low"
  };
  const name = map[severity];
  return name ? { name } : null;
}

async function searchJiraAssignableUsers(settings, projectKey, query = "") {
  const key = projectKey?.trim();
  if (!key) return [];

  const params = new URLSearchParams({ project: key, maxResults: "50" });
  const q = (query || "").trim();
  if (q) params.set("query", q);

  const data = await jiraRequest(settings, `/rest/api/3/user/assignable/search?${params}`);
  const users = Array.isArray(data) ? data : (data.values || []);

  const seen = new Set();
  return users
    .filter(u => u?.accountId && !seen.has(u.accountId) && seen.add(u.accountId))
    .map(u => ({
      accountId: u.accountId,
      displayName: u.displayName || u.emailAddress || u.accountId,
      emailAddress: u.emailAddress || ""
    }));
}

async function getJiraIssueTypes(settings, projectKey) {
  const key = projectKey?.trim();
  if (!key) throw new Error("Project key is required");

  try {
    const data = await jiraRequest(
      settings,
      `/rest/api/3/issue/createmeta/${encodeURIComponent(key)}/issuetypes`
    );
    const types = (data.issueTypes || data.values || [])
      .filter(t => !t.subtask)
      .map(t => ({ id: String(t.id), name: t.name }));
    if (types.length) return types;
  } catch {
    /* fall through */
  }

  return [
    { id: "", name: "Bug" },
    { id: "", name: "Task" },
    { id: "", name: "Story" }
  ];
}

function qaIssueAttachmentFiles(qaIssue, htmlContent, screenshotDataUrl) {
  const files = [];
  if (htmlContent?.trim()) {
    files.push({
      name: "qa-snap-report.html",
      blob: new Blob([htmlContent], { type: "text/html;charset=utf-8" })
    });
  }
  if (screenshotDataUrl?.includes(",")) {
    files.push({
      name: "qa-snap-screenshot.png",
      blob: dataUrlToBlob(screenshotDataUrl)
    });
  } else if (qaIssue.screenshot?.includes(",")) {
    files.push({
      name: "qa-snap-screenshot.png",
      blob: dataUrlToBlob(qaIssue.screenshot)
    });
  }
  return files;
}

async function createJiraIssue(settings, qaIssue, options = {}) {
  const projectKey = (options.projectKey || settings.jiraProjectKey || "").trim();
  if (!projectKey) throw new Error("Project key is required — set it in Jira settings");

  const summary = (options.summary || qaIssue.title || qaIssue.comment || "QA Snap report").trim();
  if (!summary) throw new Error("Issue summary is required");

  const issueTypeId = options.issueTypeId?.trim();
  const issueTypeName = (options.issueTypeName || settings.jiraDefaultIssueType || "Bug").trim();

  const fields = {
    project: { key: projectKey },
    summary: summary.slice(0, 255),
    issuetype: issueTypeId ? { id: issueTypeId } : { name: issueTypeName },
    description: buildQaReportAdf(qaIssue)
  };

  const priority = severityToJiraPriority(qaIssue.severity);
  if (priority) fields.priority = priority;

  const assigneeAccountId = options.assigneeAccountId?.trim();
  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };

  let created;
  try {
    created = await jiraRequest(settings, "/rest/api/3/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (err) {
    if (priority && /priority/i.test(err?.message || "")) {
      delete fields.priority;
      created = await jiraRequest(settings, "/rest/api/3/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
    } else if (fields.assignee && /assignee/i.test(err?.message || "")) {
      delete fields.assignee;
      created = await jiraRequest(settings, "/rest/api/3/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
    } else {
      throw err;
    }
  }

  const key = created.key;
  if (!key) throw new Error("Jira did not return an issue key");

  const files = qaIssueAttachmentFiles(qaIssue, options.htmlContent, options.screenshotDataUrl);
  if (files.length) await addJiraAttachments(settings, key, files);

  const issue = await getJiraIssue(settings, key);
  return {
    issueKey: key,
    issueId: issue.id,
    summary: issue.summary,
    status: issue.status,
    issueUrl: issue.url
  };
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function addJiraAttachments(settings, issueKey, files) {
  if (!files?.length) return [];

  const form = new FormData();
  for (const file of files) {
    form.append("file", file.blob, file.name);
  }

  const base = normalizeJiraSiteUrl(settings.jiraSiteUrl);
  const resp = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
    method: "POST",
    headers: {
      Authorization: jiraAuthHeader(settings),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check"
    },
    body: form
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data.errorMessages?.join("; ") || `Failed to upload attachments (${resp.status})`;
    throw new Error(msg);
  }
  return data;
}

async function addJiraComment(settings, issueKey, adfBody) {
  return jiraRequest(settings, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: adfBody })
  });
}

async function pushIssueToJira(settings, jiraIssueKey, qaIssue, htmlContent, screenshotDataUrl) {
  const key = jiraIssueKey?.trim();
  if (!key) throw new Error("Jira issue key is required");

  const files = qaIssueAttachmentFiles(qaIssue, htmlContent, screenshotDataUrl);
  if (files.length) await addJiraAttachments(settings, key, files);

  const comment = await addJiraComment(settings, key, buildJiraAdfBody(qaIssue));
  const base = normalizeJiraSiteUrl(settings.jiraSiteUrl);

  return {
    issueKey: key,
    commentId: comment.id,
    issueUrl: `${base}/browse/${key}`
  };
}
