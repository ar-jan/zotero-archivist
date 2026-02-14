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

const QUEUE_ITEM_STATUSES = new Set([
  "pending",
  "opening_tab",
  "saving_snapshot",
  "archived",
  "manual_required",
  "failed",
  "cancelled"
]);

chrome.runtime.onInstalled.addListener(() => {
  void ensureSelectorRules();
  void ensureQueueItems();
  void configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSelectorRules();
  void ensureQueueItems();
  void configureSidePanelBehavior();
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
    case MESSAGE_TYPES.SET_COLLECTED_LINKS:
      return setCollectedLinks(message.payload?.links);
    case MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION:
      return authorQueueFromSelection(message.payload?.links);
    case MESSAGE_TYPES.CLEAR_QUEUE:
      return clearQueue();
    case MESSAGE_TYPES.SET_SELECTOR_RULES:
      return setSelectorRules(message.payload?.rules);
    default:
      return createError(ERROR_CODES.BAD_REQUEST, `Unsupported message type: ${message.type}`);
  }
}

async function configureSidePanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    });
  } catch (error) {
    console.error("[zotero-archivist] Failed to configure side panel behavior.", error);
  }
}

async function getPanelState() {
  const selectorRules = await getSelectorRules();
  const queueItems = await getQueueItems();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.COLLECTED_LINKS);
  const collectedLinks = normalizeCollectedLinks(stored[STORAGE_KEYS.COLLECTED_LINKS]);

  if (!Array.isArray(stored[STORAGE_KEYS.COLLECTED_LINKS])) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.COLLECTED_LINKS]: collectedLinks
    });
  }

  return {
    selectorRules,
    collectedLinks,
    queueItems
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

async function setCollectedLinks(rawLinks) {
  const links = normalizeCollectedLinks(rawLinks);
  await chrome.storage.local.set({
    [STORAGE_KEYS.COLLECTED_LINKS]: links
  });

  return createSuccess({
    links,
    collectedCount: links.length,
    selectedCount: links.filter((link) => link.selected !== false).length
  });
}

async function authorQueueFromSelection(rawLinks) {
  const selectedLinks = normalizeCollectedLinks(rawLinks).filter((link) => link.selected !== false);
  if (selectedLinks.length === 0) {
    return createError(ERROR_CODES.BAD_REQUEST, "Select at least one link to add to queue.");
  }

  const queueItems = await getQueueItems();
  const seenQueueUrls = new Set(queueItems.map((item) => item.url.toLowerCase()));
  const nextQueueItems = [...queueItems];

  let addedCount = 0;
  let skippedCount = 0;
  const now = Date.now();
  for (const link of selectedLinks) {
    const dedupeKey = link.url.toLowerCase();
    if (seenQueueUrls.has(dedupeKey)) {
      skippedCount += 1;
      continue;
    }

    seenQueueUrls.add(dedupeKey);
    addedCount += 1;
    nextQueueItems.push({
      id: createQueueItemId(now, nextQueueItems.length + 1),
      url: link.url,
      title: link.title,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_ITEMS]: nextQueueItems
  });

  return createSuccess({
    queueItems: nextQueueItems,
    selectedCount: selectedLinks.length,
    addedCount,
    skippedCount
  });
}

async function clearQueue() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_ITEMS]: []
  });

  return createSuccess({
    queueItems: []
  });
}

async function getSelectorRules() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SELECTOR_RULES);
  const rawRules = stored[STORAGE_KEYS.SELECTOR_RULES];
  const sanitizedRules = sanitizeSelectorRules(rawRules);
  const defaults = DEFAULT_SELECTOR_RULES.map((rule) => ({ ...rule }));

  if (sanitizedRules.length === 0) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTOR_RULES]: defaults });
    return defaults;
  }

  if (isLegacyAnchorOnlyDefault(sanitizedRules)) {
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

async function ensureQueueItems() {
  await getQueueItems();
}

async function getQueueItems() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE_ITEMS);
  const rawQueueItems = stored[STORAGE_KEYS.QUEUE_ITEMS];
  const queueItems = normalizeQueueItems(rawQueueItems);

  const needsWriteBack =
    !Array.isArray(rawQueueItems) || JSON.stringify(rawQueueItems) !== JSON.stringify(queueItems);

  if (needsWriteBack) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.QUEUE_ITEMS]: queueItems
    });
  }

  return queueItems;
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

function normalizeQueueItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const now = Date.now();
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
    const dedupeKey = url.toLowerCase();
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    const createdAt =
      Number.isFinite(candidate.createdAt) && candidate.createdAt > 0
        ? Math.trunc(candidate.createdAt)
        : now;
    const updatedAt =
      Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0
        ? Math.max(Math.trunc(candidate.updatedAt), createdAt)
        : createdAt;

    const queueItem = {
      id:
        typeof candidate.id === "string" && candidate.id.length > 0
          ? candidate.id
          : createQueueItemId(now, normalized.length + 1),
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim().length > 0
          ? candidate.title.trim()
          : url,
      status:
        typeof candidate.status === "string" && QUEUE_ITEM_STATUSES.has(candidate.status)
          ? candidate.status
          : "pending",
      attempts:
        Number.isFinite(candidate.attempts) && candidate.attempts >= 0
          ? Math.trunc(candidate.attempts)
          : 0,
      createdAt,
      updatedAt
    };

    if (typeof candidate.lastError === "string" && candidate.lastError.trim().length > 0) {
      queueItem.lastError = candidate.lastError.trim();
    }

    normalized.push(queueItem);
  }

  return normalized;
}

function createQueueItemId(timestamp, index) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `queue-${crypto.randomUUID()}`;
  }
  return `queue-${timestamp}-${index}`;
}

function isLegacyAnchorOnlyDefault(rules) {
  if (!Array.isArray(rules) || rules.length !== 1) {
    return false;
  }

  const rule = rules[0];
  if (!rule || typeof rule !== "object") {
    return false;
  }

  const normalizedName = typeof rule.name === "string" ? rule.name.trim().toLowerCase() : "";
  return (
    rule.id === "anchors" &&
    rule.cssSelector === "a[href]" &&
    rule.urlAttribute === "href" &&
    rule.enabled === true &&
    (normalizedName === "all anchor links" || normalizedName === "anchors")
  );
}
