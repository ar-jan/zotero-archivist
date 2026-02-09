import {
  DEFAULT_SELECTOR_RULES,
  ERROR_CODES,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  createError,
  createSuccess,
  isHttpUrl,
  sanitizeSelectorRules,
  toOriginPattern
} from "../shared/protocol.js";

chrome.runtime.onInstalled.addListener(() => {
  void ensureSelectorRules();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSelectorRules();
});

chrome.action.onClicked.addListener((tab) => {
  void openSidePanel(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("[zotero-archivist] Unhandled runtime error", error);
      sendResponse(createError(ERROR_CODES.INTERNAL_ERROR, "Unexpected runtime error."));
    });

  return true;
});

async function handleMessage(message, _sender) {
  if (!message || typeof message.type !== "string") {
    return createError(ERROR_CODES.BAD_REQUEST, "Invalid runtime message.");
  }

  switch (message.type) {
    case MESSAGE_TYPES.GET_PANEL_STATE:
      return createSuccess(await getPanelState());
    case MESSAGE_TYPES.COLLECT_LINKS:
      return collectLinksFromActiveTab();
    case MESSAGE_TYPES.SET_SELECTOR_RULES:
      return setSelectorRules(message.payload?.rules);
    default:
      return createError(ERROR_CODES.BAD_REQUEST, `Unsupported message type: ${message.type}`);
  }
}

async function openSidePanel(tab) {
  const windowId = Number.isInteger(tab?.windowId) ? tab.windowId : undefined;
  if (!Number.isInteger(windowId)) {
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId });
  } catch (error) {
    console.error("[zotero-archivist] Failed to open side panel.", error);
  }
}

async function getPanelState() {
  const selectorRules = await getSelectorRules();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.COLLECTED_LINKS);
  const collectedLinks = normalizeCollectedLinks(stored[STORAGE_KEYS.COLLECTED_LINKS]);

  if (!Array.isArray(stored[STORAGE_KEYS.COLLECTED_LINKS])) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.COLLECTED_LINKS]: collectedLinks
    });
  }

  return {
    selectorRules,
    collectedLinks
  };
}

async function collectLinksFromActiveTab() {
  const activeTab = await getActiveTab();
  if (!activeTab || !Number.isInteger(activeTab.id)) {
    return createError(ERROR_CODES.NO_ACTIVE_TAB, "No active tab found.");
  }

  if (!isHttpUrl(activeTab.url)) {
    return createError(
      ERROR_CODES.UNSUPPORTED_URL,
      "Collect Links only works on http(s) pages.",
      { tabUrl: activeTab.url ?? null }
    );
  }

  const originPattern = toOriginPattern(activeTab.url);
  if (!originPattern) {
    return createError(ERROR_CODES.UNSUPPORTED_URL, "Unable to derive host permission pattern.");
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission) {
    return createError(ERROR_CODES.MISSING_HOST_PERMISSION, "Host permission required.", {
      originPattern
    });
  }

  const selectorRules = await getSelectorRules();

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content/collector.js"]
    });
  } catch (error) {
    return createError(ERROR_CODES.COLLECTOR_ERROR, "Failed to inject collector script.", {
      reason: String(error)
    });
  }

  let collectorResponse;
  try {
    collectorResponse = await chrome.tabs.sendMessage(activeTab.id, {
      type: MESSAGE_TYPES.RUN_COLLECTOR,
      payload: {
        rules: selectorRules
      }
    });
  } catch (error) {
    return createError(ERROR_CODES.COLLECTOR_ERROR, "Collector did not respond.", {
      reason: String(error)
    });
  }

  if (!collectorResponse || collectorResponse.ok !== true) {
    return createError(ERROR_CODES.COLLECTOR_ERROR, "Collector returned an error.", {
      collectorError: collectorResponse?.error ?? null
    });
  }

  const links = normalizeCollectedLinks(collectorResponse.links);
  await chrome.storage.local.set({
    [STORAGE_KEYS.COLLECTED_LINKS]: links
  });

  return createSuccess({
    links,
    collectedCount: links.length
  });
}

async function getSelectorRules() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SELECTOR_RULES);
  const rawRules = stored[STORAGE_KEYS.SELECTOR_RULES];
  const sanitizedRules = sanitizeSelectorRules(rawRules);

  if (sanitizedRules.length === 0) {
    const defaults = DEFAULT_SELECTOR_RULES.map((rule) => ({ ...rule }));
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: defaults });
    return defaults;
  }

  const needsWriteBack =
    !Array.isArray(rawRules) || JSON.stringify(rawRules) !== JSON.stringify(sanitizedRules);

  if (needsWriteBack) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: sanitizedRules });
  }

  return sanitizedRules;
}

async function setSelectorRules(rawRules) {
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    return createError(
      ERROR_CODES.INVALID_SELECTOR_RULES,
      "At least one selector rule is required."
    );
  }

  const sanitizedRules = sanitizeSelectorRules(rawRules);
  if (sanitizedRules.length !== rawRules.length || sanitizedRules.length === 0) {
    return createError(
      ERROR_CODES.INVALID_SELECTOR_RULES,
      "One or more selector rules are invalid.",
      {
        submittedCount: rawRules.length,
        validCount: sanitizedRules.length
      }
    );
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.SELECTOR_RULES]: sanitizedRules
  });

  return createSuccess({
    selectorRules: sanitizedRules
  });
}

async function ensureSelectorRules() {
  await getSelectorRules();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tabs[0] ?? null;
}

function normalizeCollectedLinks(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const dedupe = new Set();
  const normalized = [];
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.url !== "string") {
      continue;
    }

    if (!isHttpUrl(candidate.url)) {
      continue;
    }

    const url = new URL(candidate.url).toString();
    const dedupeKey =
      typeof candidate.dedupeKey === "string" && candidate.dedupeKey.length > 0
        ? candidate.dedupeKey
        : url.toLowerCase();

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.add(dedupeKey);
    normalized.push({
      id:
        typeof candidate.id === "string" && candidate.id.length > 0
          ? candidate.id
          : `link-${normalized.length + 1}`,
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : url,
      sourceSelectorId:
        typeof candidate.sourceSelectorId === "string" && candidate.sourceSelectorId.length > 0
          ? candidate.sourceSelectorId
          : "unknown",
      selected: candidate.selected !== false,
      dedupeKey
    });
  }

  return normalized;
}
