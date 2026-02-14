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
  clearQueueRuntimeActive,
  createQueueItemId,
  isQueueItemActiveStatus,
  normalizeCollectedLinks
} from "../shared/state.js";
import { routeMessage } from "./message-router.js";
import { createProviderOrchestrator } from "./provider-orchestrator.js";
import { createQueueEngine, QUEUE_ENGINE_ALARM_NAME } from "./queue-engine.js";
import {
  ensureProviderDiagnostics,
  ensureProviderSettings,
  ensureQueueItems,
  ensureQueueRuntime,
  ensureSelectorRules,
  getCollectedLinks,
  getProviderSettings,
  getQueueItems,
  getQueueRuntime,
  getSelectorRules,
  saveCollectedLinks,
  saveProviderDiagnostics,
  saveProviderSettings,
  saveQueueItems,
  saveQueueRuntime,
  saveSelectorRules
} from "./storage-repo.js";

const providerOrchestrator = createProviderOrchestrator({
  getProviderSettings,
  saveProviderDiagnostics
});

const queueEngine = createQueueEngine({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  saveQueueItemWithProvider: providerOrchestrator.saveQueueItemWithProvider
});

const messageHandlers = {
  [MESSAGE_TYPES.GET_PANEL_STATE]: async () => createSuccess(await getPanelState()),
  [MESSAGE_TYPES.COLLECT_LINKS]: async () => collectLinksFromActiveTab(),
  [MESSAGE_TYPES.SET_COLLECTED_LINKS]: async (message) => setCollectedLinks(message.payload?.links),
  [MESSAGE_TYPES.AUTHOR_QUEUE_FROM_SELECTION]: async (message) =>
    authorQueueFromSelection(message.payload?.links),
  [MESSAGE_TYPES.CLEAR_QUEUE]: async () => clearQueue(),
  [MESSAGE_TYPES.START_QUEUE]: async () => startQueue(),
  [MESSAGE_TYPES.PAUSE_QUEUE]: async () => pauseQueue(),
  [MESSAGE_TYPES.RESUME_QUEUE]: async () => resumeQueue(),
  [MESSAGE_TYPES.STOP_QUEUE]: async () => stopQueue(),
  [MESSAGE_TYPES.RETRY_FAILED_QUEUE]: async () => retryFailedQueue(),
  [MESSAGE_TYPES.SET_PROVIDER_SETTINGS]: async (message) =>
    setProviderSettings(message.payload?.settings),
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
    ensureSelectorRules(),
    ensureQueueItems(),
    ensureQueueRuntime(),
    ensureProviderSettings(),
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
  const queueItems = await getQueueItems();
  const queueRuntime = await getQueueRuntime();
  const providerSettings = await getProviderSettings();
  const providerDiagnostics = await providerOrchestrator.refreshProviderDiagnostics();

  return {
    selectorRules,
    collectedLinks,
    queueItems,
    queueRuntime,
    providerSettings,
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

async function clearQueue() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status === "running") {
    return createError(ERROR_CODES.BAD_REQUEST, "Stop or pause the queue before clearing it.");
  }

  if (Number.isInteger(queueRuntime.activeTabId)) {
    await queueEngine.closeTabIfPresent(queueRuntime.activeTabId);
  }

  await saveQueueItems([]);
  const nextRuntime = {
    ...clearQueueRuntimeActive(queueRuntime),
    status: "idle",
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);

  return createSuccess({
    queueItems: [],
    queueRuntime: nextRuntime
  });
}

async function startQueue() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status === "running") {
    return createSuccess({
      queueRuntime,
      queueItems: await getQueueItems(),
      alreadyRunning: true
    });
  }

  if (queueRuntime.status === "paused") {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue is paused. Use Resume Queue.");
  }

  const queueItems = await getQueueItems();
  const pendingCount = queueItems.filter((item) => item.status === "pending").length;
  if (pendingCount === 0) {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue has no pending items.");
  }

  const nextRuntime = {
    ...clearQueueRuntimeActive(queueRuntime),
    status: "running",
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);
  queueEngine.runQueueEngineSoon("start");

  return createSuccess({
    queueRuntime: nextRuntime,
    queueItems,
    pendingCount
  });
}

async function pauseQueue() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue is not running.");
  }

  const nextRuntime = {
    ...queueRuntime,
    status: "paused",
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);
  await queueEngine.clearQueueAlarm();

  return createSuccess({
    queueRuntime: nextRuntime,
    queueItems: await getQueueItems()
  });
}

async function resumeQueue() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "paused") {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue is not paused.");
  }

  const queueItems = await getQueueItems();
  const hasPending = queueItems.some((item) => item.status === "pending");
  if (!hasPending && !queueRuntime.activeQueueItemId) {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue has no pending items.");
  }

  const nextRuntime = {
    ...queueRuntime,
    status: "running",
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);
  queueEngine.runQueueEngineSoon("resume");

  return createSuccess({
    queueRuntime: nextRuntime,
    queueItems
  });
}

async function stopQueue() {
  const queueRuntime = await getQueueRuntime();
  const queueItems = await getQueueItems();
  const activeTabId = Number.isInteger(queueRuntime.activeTabId) ? queueRuntime.activeTabId : null;

  let nextQueueItems = queueItems;
  if (typeof queueRuntime.activeQueueItemId === "string") {
    const activeIndex = nextQueueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
    if (activeIndex >= 0 && isQueueItemActiveStatus(nextQueueItems[activeIndex].status)) {
      nextQueueItems = [...nextQueueItems];
      nextQueueItems[activeIndex] = {
        ...nextQueueItems[activeIndex],
        status: "cancelled",
        lastError: "Queue was stopped before completion.",
        updatedAt: Date.now()
      };
      await saveQueueItems(nextQueueItems);
    }
  }

  const nextRuntime = {
    ...clearQueueRuntimeActive(queueRuntime),
    status: "idle",
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);
  await queueEngine.clearQueueAlarm();
  if (activeTabId !== null) {
    await queueEngine.closeTabIfPresent(activeTabId);
  }

  return createSuccess({
    queueRuntime: nextRuntime,
    queueItems: nextQueueItems
  });
}

async function retryFailedQueue() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status === "running") {
    return createError(ERROR_CODES.BAD_REQUEST, "Pause or stop the queue before retrying items.");
  }

  const queueItems = await getQueueItems();
  let retriedCount = 0;
  const nextQueueItems = queueItems.map((item) => {
    if (item.status !== "failed" && item.status !== "cancelled") {
      return item;
    }

    retriedCount += 1;
    return {
      ...item,
      status: "pending",
      updatedAt: Date.now(),
      lastError: undefined
    };
  });

  if (retriedCount === 0) {
    return createError(ERROR_CODES.BAD_REQUEST, "Queue has no failed or cancelled items.");
  }

  await saveQueueItems(nextQueueItems);

  return createSuccess({
    queueItems: nextQueueItems,
    queueRuntime,
    retriedCount
  });
}

async function setProviderSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== "object") {
    return createError(ERROR_CODES.INVALID_PROVIDER_SETTINGS, "Invalid provider settings payload.");
  }

  const providerSettings = await saveProviderSettings(rawSettings);
  const providerDiagnostics = await providerOrchestrator.refreshProviderDiagnostics();

  return createSuccess({
    providerSettings,
    providerDiagnostics
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tabs[0] ?? null;
}
