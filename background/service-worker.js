import {
  ERROR_CODES,
  MESSAGE_TYPES,
  createError,
  createSuccess,
  isHttpUrl,
  sanitizeSelectorRules,
  toOriginPattern
} from "../shared/protocol.js";
import {
  createQueueItemId,
  normalizeCollectedLinks
} from "../shared/state.js";
import { routeMessage } from "./message-router.js";
import { createProviderOrchestrator } from "./provider-orchestrator.js";
import { createQueueEngine, QUEUE_ENGINE_ALARM_NAME } from "./queue-engine.js";
import { createQueueLifecycleHandlers } from "./queue-lifecycle.js";
import {
  ensureCollectorSettings,
  ensureProviderDiagnostics,
  ensureQueueItems,
  ensureQueueSettings,
  ensureQueueRuntime,
  ensureSelectorRules,
  getCollectorSettings,
  getCollectedLinks,
  getQueueItems,
  getQueueSettings,
  getQueueRuntime,
  getSelectorRules,
  saveCollectedLinks,
  saveProviderDiagnostics,
  saveQueueItems,
  saveQueueSettings,
  saveQueueRuntime,
  saveSelectorRules
} from "./storage-repo.js";

const providerOrchestrator = createProviderOrchestrator({
  saveProviderDiagnostics
});

const queueEngine = createQueueEngine({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  getQueueSettings,
  saveQueueItemWithProvider: providerOrchestrator.saveQueueItemWithProvider
});

const queueLifecycleHandlers = createQueueLifecycleHandlers({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  queueEngine
});

const messageHandlers = {
  [MESSAGE_TYPES.GET_PANEL_STATE]: async () => createSuccess(await getPanelState()),
  [MESSAGE_TYPES.COLLECT_LINKS]: async () => collectLinksFromActiveTab(),
  [MESSAGE_TYPES.SET_COLLECTED_LINKS]: async (message) => setCollectedLinks(message.payload?.links),
  [MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION]: async (message) =>
    authorQueueFromSelection(message.payload?.links),
  [MESSAGE_TYPES.SET_QUEUE_SETTINGS]: async (message) =>
    setQueueSettings(message.payload?.queueSettings),
  [MESSAGE_TYPES.CLEAR_QUEUE]: async () => queueLifecycleHandlers.clearQueue(),
  [MESSAGE_TYPES.START_QUEUE]: async () => queueLifecycleHandlers.startQueue(),
  [MESSAGE_TYPES.PAUSE_QUEUE]: async () => queueLifecycleHandlers.pauseQueue(),
  [MESSAGE_TYPES.RESUME_QUEUE]: async () => queueLifecycleHandlers.resumeQueue(),
  [MESSAGE_TYPES.STOP_QUEUE]: async () => queueLifecycleHandlers.stopQueue(),
  [MESSAGE_TYPES.RETRY_FAILED_QUEUE]: async () => queueLifecycleHandlers.retryFailedQueue(),
  [MESSAGE_TYPES.SET_SELECTOR_RULES]: async (message) => setSelectorRules(message.payload?.rules)
};

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtensionState();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtensionState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("[zotero-archivist] Unhandled runtime error", error);
      sendResponse(createError(ERROR_CODES.INTERNAL_ERROR, "Unexpected runtime error."));
    });

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== QUEUE_ENGINE_ALARM_NAME) {
    return;
  }

  void queueEngine.handleQueueAlarm();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void queueEngine.handleQueueTabUpdated(tabId, changeInfo);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void queueEngine.handleQueueTabRemoved(tabId);
});

async function initializeExtensionState() {
  await Promise.all([
    ensureCollectorSettings(),
    ensureQueueSettings(),
    ensureSelectorRules(),
    ensureQueueItems(),
    ensureQueueRuntime(),
    ensureProviderDiagnostics()
  ]);
  await configureSidePanelBehavior();
  await providerOrchestrator.refreshProviderDiagnostics();
  await queueEngine.recoverQueueEngineState();
}

async function handleMessage(message) {
  return routeMessage(message, messageHandlers);
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
  const collectedLinks = await getCollectedLinks();
  const queueSettings = await getQueueSettings();
  const queueItems = await getQueueItems();
  const queueRuntime = await getQueueRuntime();
  const providerDiagnostics = await providerOrchestrator.refreshProviderDiagnostics();

  return {
    selectorRules,
    collectedLinks,
    queueSettings,
    queueItems,
    queueRuntime,
    providerDiagnostics
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
  const collectorSettings = await getCollectorSettings();

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
        rules: selectorRules,
        maxLinks: collectorSettings.maxLinksPerRun,
        autoScrollEnabled: collectorSettings.autoScrollEnabled,
        autoScrollMaxRounds: collectorSettings.autoScrollMaxRounds,
        autoScrollIdleRounds: collectorSettings.autoScrollIdleRounds,
        autoScrollSettleDelayMs: collectorSettings.autoScrollSettleDelayMs
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

  const links = await saveCollectedLinks(collectorResponse.links);
  const providerDiagnostics = await providerOrchestrator.refreshProviderDiagnostics();

  return createSuccess({
    links,
    collectedCount: links.length,
    providerDiagnostics
  });
}

async function setCollectedLinks(rawLinks) {
  const links = await saveCollectedLinks(rawLinks);
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

  await saveQueueItems(nextQueueItems);

  return createSuccess({
    queueItems: nextQueueItems,
    selectedCount: selectedLinks.length,
    addedCount,
    skippedCount
  });
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

  await saveSelectorRules(sanitizedRules);

  return createSuccess({
    selectorRules: sanitizedRules
  });
}

async function setQueueSettings(rawQueueSettings) {
  const queueSettings = await saveQueueSettings(rawQueueSettings);
  return createSuccess({
    queueSettings
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tabs[0] ?? null;
}
