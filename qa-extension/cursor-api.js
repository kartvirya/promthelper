// cursor-api.js — Cursor Cloud Agents API helpers (loaded by background.js)

const CURSOR_API = "https://api.cursor.com";

function buildCursorPrompt(issue) {
  return buildIssuePrompt(issue);
}

async function cursorApiRequest(apiKey, path, body) {
  const resp = await fetch(`${CURSOR_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      data.error?.message ||
      data.message ||
      data.error ||
      (typeof data === "string" ? data : null) ||
      `Cursor API error (${resp.status})`;
    throw new Error(msg);
  }
  return data;
}

async function verifyCursorApiKey(apiKey) {
  const resp = await fetch(`${CURSOR_API}/v1/me`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` }
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Invalid API key (${resp.status})`);
  }
  return resp.json();
}

async function sendIssueToCursor(issue, settings) {
  const imageData = issue.apiImageBase64 || (issue.screenshot || "").split(",")[1];
  if (!imageData) throw new Error("No screenshot to send");

  const prompt = {
    text: buildCursorPrompt(issue),
    images: [{ data: imageData, mimeType: issue.apiMimeType || "image/png" }]
  };

  let data;
  if (settings.continueThread && settings.cursorAgentId) {
    data = await cursorApiRequest(
      settings.cursorApiKey,
      `/v1/agents/${settings.cursorAgentId}/runs`,
      { prompt }
    );
    return {
      agentId: settings.cursorAgentId,
      agentUrl: `https://cursor.com/agents/${settings.cursorAgentId}`,
      runId: data.run?.id
    };
  }

  const body = {
    prompt,
    name: `QA #${issue.num || "new"}: ${(issue.comment || "Bug report").slice(0, 60)}`
  };

  if (settings.repoUrl?.trim()) {
    body.repos = [
      {
        url: settings.repoUrl.trim(),
        startingRef: (settings.repoBranch || "main").trim()
      }
    ];
  }

  if (settings.modelId?.trim()) {
    body.model = { id: settings.modelId.trim() };
  }

  data = await cursorApiRequest(settings.cursorApiKey, "/v1/agents", body);

  const agent = data.agent || {};
  return {
    agentId: agent.id,
    agentUrl: agent.url || (agent.id ? `https://cursor.com/agents/${agent.id}` : null),
    runId: data.run?.id
  };
}
