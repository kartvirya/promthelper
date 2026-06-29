// background.js — tab capture + Cursor API

importScripts("issue-prompt.js", "cursor-api.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureTab") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      chrome.tabs.captureVisibleTab(null, { format: "png", quality: 100 }, dataUrl => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl, url: tabs[0].url, title: tabs[0].title });
        }
      });
    });
    return true;
  }

  if (message.action === "capturePageHtml") {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        sendResponse({ error: "Can't capture HTML on this page" });
        return;
      }
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action: "capturePageHtml" });
        sendResponse(resp || { error: "Could not capture HTML — reload the page" });
      } catch {
        sendResponse({ error: "Could not capture HTML — reload the page" });
      }
    });
    return true;
  }

  if (message.action === "getTabInfo") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        sendResponse({ url: tabs[0].url, title: tabs[0].title });
      } else {
        sendResponse({ url: "", title: "" });
      }
    });
    return true;
  }

  if (message.action === "verifyCursorKey") {
    verifyCursorApiKey(message.apiKey)
      .then(me => sendResponse({ ok: true, me }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === "sendToCursor") {
    sendIssueToCursor(message.issue, message.settings)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
