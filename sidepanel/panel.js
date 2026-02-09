import {
  ERROR_CODES,
  MESSAGE_TYPES,
  isHttpUrl,
  toOriginPattern
} from "../shared/protocol.js";

const collectButton = document.getElementById("collect-links-button");
const statusEl = document.getElementById("status");
const resultsTitleEl = document.getElementById("results-title");
const resultsListEl = document.getElementById("results-list");
const rulesSummaryEl = document.getElementById("rules-summary");

collectButton.addEventListener("click", () => {
  void collectLinks();
});

void loadPanelState();

async function loadPanelState() {
  setStatus("Loading panel state...");

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_PANEL_STATE
  });

  if (!response || response.ok !== true) {
    setStatus(messageFromError(response?.error) ?? "Failed to load extension state.");
    return;
  }

  const selectorRules = Array.isArray(response.selectorRules) ? response.selectorRules : [];
  const collectedLinks = Array.isArray(response.collectedLinks) ? response.collectedLinks : [];

  rulesSummaryEl.textContent = `${selectorRules.length} selector rule(s) configured`;
  renderLinks(collectedLinks);
  setStatus("Ready.");
}

async function collectLinks() {
  collectButton.disabled = true;

  try {
    const activeTab = await getActiveTab();
    if (!activeTab || typeof activeTab.url !== "string") {
      setStatus("No active tab found.");
      return;
    }

    if (!isHttpUrl(activeTab.url)) {
      setStatus("Collect Links only works on http(s) pages.");
      return;
    }

    setStatus("Checking host permission...");
    const permissionResult = await ensureHostPermission(activeTab.url);
    if (!permissionResult.granted) {
      setStatus("Permission was not granted for this site.");
      return;
    }

    setStatus("Collecting links...");
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.COLLECT_LINKS
    });

    if (!response || response.ok !== true) {
      const errorCode = response?.error?.code;
      if (errorCode === ERROR_CODES.MISSING_HOST_PERMISSION) {
        setStatus("Host permission is required to collect links.");
      } else {
        setStatus(messageFromError(response?.error) ?? "Collect Links failed.");
      }
      return;
    }

    const links = Array.isArray(response.links) ? response.links : [];
    renderLinks(links);
    setStatus(`Collected ${links.length} link(s).`);
  } catch (error) {
    console.error("[zotero-archivist] Collect Links failed.", error);
    setStatus("Collect Links failed.");
  } finally {
    collectButton.disabled = false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] ?? null;
}

async function ensureHostPermission(tabUrl) {
  const originPattern = toOriginPattern(tabUrl);
  if (!originPattern) {
    return { granted: false };
  }

  const hasPermission = await chrome.permissions.contains({
    origins: [originPattern]
  });
  if (hasPermission) {
    return { granted: true, alreadyGranted: true, originPattern };
  }

  const granted = await chrome.permissions.request({
    origins: [originPattern]
  });
  return { granted, alreadyGranted: false, originPattern };
}

function renderLinks(links) {
  const safeLinks = Array.isArray(links) ? links : [];

  resultsListEl.textContent = "";
  resultsTitleEl.textContent = `Collected Links (${safeLinks.length})`;

  for (const link of safeLinks) {
    const item = document.createElement("li");
    item.className = "result-item";

    const anchor = document.createElement("a");
    anchor.className = "result-link";
    anchor.href = typeof link.url === "string" ? link.url : "#";
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent = typeof link.title === "string" && link.title.trim().length > 0 ? link.title : anchor.href;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = anchor.href;

    item.append(anchor, meta);
    resultsListEl.append(item);
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function messageFromError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return null;
}
