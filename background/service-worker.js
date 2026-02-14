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
import {
  normalizeProviderDiagnostics,
  normalizeProviderSettings
} from "../zotero/provider-interface.js";
import { createConnectorBridgeProvider } from "../zotero/provider-connector-bridge.js";

const QUEUE_ITEM_STATUSES = new Set([
  "pending",
  "opening_tab",
  "saving_snapshot",
  "archived",
  "failed",
  "cancelled"
]);

const QUEUE_RUNTIME_STATUSES = new Set(["idle", "running", "paused"]);
const QUEUE_ACTIVE_ITEM_STATUSES = new Set(["opening_tab", "saving_snapshot"]);
const QUEUE_ALARM_NAME = "queue-engine-watchdog";
const QUEUE_ALARM_DELAY_MINUTES = 1;
const QUEUE_TAB_LOAD_TIMEOUT_MESSAGE = "Queue tab did not finish loading before timeout.";
const QUEUE_TAB_CLOSED_MESSAGE = "Queue tab was closed before loading completed.";
const CONNECTOR_BRIDGE_DISABLED_MESSAGE = "Connector bridge is disabled.";

let queueEngineRun = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtensionState();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtensionState();
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== QUEUE_ALARM_NAME) {
    return;
  }

  void handleQueueAlarm();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void handleQueueTabUpdated(tabId, changeInfo);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleQueueTabRemoved(tabId);
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
  await recoverQueueEngineState();
}

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
    case MESSAGE_TYPES.START_QUEUE:
      return startQueue();
    case MESSAGE_TYPES.PAUSE_QUEUE:
      return pauseQueue();
    case MESSAGE_TYPES.RESUME_QUEUE:
      return resumeQueue();
    case MESSAGE_TYPES.STOP_QUEUE:
      return stopQueue();
    case MESSAGE_TYPES.RETRY_FAILED_QUEUE:
      return retryFailedQueue();
    case MESSAGE_TYPES.SET_PROVIDER_SETTINGS:
      return setProviderSettings(message.payload?.settings);
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
  const queueRuntime = await getQueueRuntime();
  const providerSettings = await getProviderSettings();
  const providerDiagnostics = await refreshProviderDiagnostics("panel-state");
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

  const links = normalizeCollectedLinks(collectorResponse.links);
  await chrome.storage.local.set({
    [STORAGE_KEYS.COLLECTED_LINKS]: links
  });
  const providerDiagnostics = await refreshProviderDiagnostics("collect-links");

  return createSuccess({
    links,
    collectedCount: links.length,
    providerDiagnostics
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
    await closeTabIfPresent(queueRuntime.activeTabId);
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
  runQueueEngineSoon("start");

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
  await clearQueueAlarm();

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
  runQueueEngineSoon("resume");

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
  await clearQueueAlarm();
  if (activeTabId !== null) {
    await closeTabIfPresent(activeTabId);
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

  const providerSettings = normalizeProviderSettings(rawSettings);
  await saveProviderSettings(providerSettings);
  const providerDiagnostics = await refreshProviderDiagnostics("settings-updated");

  return createSuccess({
    providerSettings,
    providerDiagnostics
  });
}

function runQueueEngineSoon(trigger) {
  queueEngineRun = queueEngineRun
    .catch(() => undefined)
    .then(() => runQueueEngine(trigger))
    .catch((error) => {
      console.error("[zotero-archivist] Queue engine run failed.", { trigger, error });
    });
}

async function runQueueEngine(_trigger) {
  let queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    await clearQueueAlarm();
    return;
  }

  let queueItems = await getQueueItems();

  if (typeof queueRuntime.activeQueueItemId === "string") {
    const activeIndex = queueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
    if (activeIndex < 0) {
      queueRuntime = {
        ...clearQueueRuntimeActive(queueRuntime),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(queueRuntime);
      await clearQueueAlarm();
      return;
    }

    if (!Number.isInteger(queueRuntime.activeTabId)) {
      queueItems = [...queueItems];
      queueItems[activeIndex] = markQueueItemFailed(
        queueItems[activeIndex],
        "Queue runtime lost active tab context."
      );
      await saveQueueItems(queueItems);
      queueRuntime = {
        ...clearQueueRuntimeActive(queueRuntime),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(queueRuntime);
      await clearQueueAlarm();
      runQueueEngineSoon("missing-active-tab-id");
      return;
    }

    const activeTabId = queueRuntime.activeTabId;
    const activeTabState = await getQueueTabState(activeTabId);
    if (activeTabState === "loading") {
      await scheduleQueueAlarm();
      return;
    }

    if (activeTabState === "missing") {
      queueItems = [...queueItems];
      queueItems[activeIndex] = markQueueItemFailed(queueItems[activeIndex], QUEUE_TAB_CLOSED_MESSAGE);
      await saveQueueItems(queueItems);
      queueRuntime = {
        ...clearQueueRuntimeActive(queueRuntime),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(queueRuntime);
      await clearQueueAlarm();
      runQueueEngineSoon("active-tab-missing");
      return;
    }

    queueItems = [...queueItems];
    const itemForSave = {
      ...queueItems[activeIndex],
      status: "saving_snapshot",
      updatedAt: Date.now()
    };
    queueItems[activeIndex] = itemForSave;
    await saveQueueItems(queueItems);

    const saveResult = await saveQueueItemWithProvider({
      queueItem: itemForSave,
      tabId: activeTabId
    });

    queueItems = await getQueueItems();
    const refreshedActiveIndex = queueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
    if (refreshedActiveIndex < 0) {
      queueRuntime = {
        ...clearQueueRuntimeActive(await getQueueRuntime()),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(queueRuntime);
      await clearQueueAlarm();
      return;
    }

    const nextQueueItems = [...queueItems];
    if (saveResult.ok) {
      nextQueueItems[refreshedActiveIndex] = {
        ...nextQueueItems[refreshedActiveIndex],
        status: "archived",
        updatedAt: Date.now(),
        lastError: undefined
      };
      await saveQueueItems(nextQueueItems);
      await closeTabIfPresent(activeTabId);

      queueRuntime = {
        ...clearQueueRuntimeActive(await getQueueRuntime()),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(queueRuntime);
      await clearQueueAlarm();
      runQueueEngineSoon("save-success");
      return;
    }

    nextQueueItems[refreshedActiveIndex] = {
      ...markQueueItemFailed(
        nextQueueItems[refreshedActiveIndex],
        typeof saveResult.error === "string" && saveResult.error.length > 0
          ? saveResult.error
          : "Snapshot save failed."
      )
    };
    await saveQueueItems(nextQueueItems);
    await closeTabIfPresent(activeTabId);

    queueRuntime = {
      ...clearQueueRuntimeActive(await getQueueRuntime()),
      updatedAt: Date.now()
    };
    await saveQueueRuntime(queueRuntime);
    await clearQueueAlarm();
    runQueueEngineSoon("save-failed");
    return;
  }

  queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    await clearQueueAlarm();
    return;
  }

  queueItems = await getQueueItems();
  const nextItemIndex = queueItems.findIndex((item) => item.status === "pending");
  if (nextItemIndex < 0) {
    const nextRuntime = {
      ...clearQueueRuntimeActive(queueRuntime),
      status: "idle",
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    await clearQueueAlarm();
    return;
  }

  const nextQueueItems = [...queueItems];
  const itemToRun = {
    ...nextQueueItems[nextItemIndex],
    status: "opening_tab",
    attempts: nextQueueItems[nextItemIndex].attempts + 1,
    updatedAt: Date.now()
  };
  nextQueueItems[nextItemIndex] = itemToRun;
  await saveQueueItems(nextQueueItems);

  let openedTabId;
  try {
    const openedTab = await chrome.tabs.create({
      url: itemToRun.url,
      active: false
    });
    openedTabId = openedTab?.id;
  } catch (error) {
    nextQueueItems[nextItemIndex] = markQueueItemFailed(
      itemToRun,
      `Failed to open queue tab: ${String(error)}`
    );
    await saveQueueItems(nextQueueItems);
    runQueueEngineSoon("tab-create-error");
    return;
  }

  if (!Number.isInteger(openedTabId)) {
    nextQueueItems[nextItemIndex] = markQueueItemFailed(itemToRun, "Queue tab did not provide a tab id.");
    await saveQueueItems(nextQueueItems);
    runQueueEngineSoon("missing-tab-id");
    return;
  }

  const nextRuntime = {
    ...queueRuntime,
    activeQueueItemId: itemToRun.id,
    activeTabId: openedTabId,
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);
  await scheduleQueueAlarm();
}

async function handleQueueAlarm() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    return;
  }

  if (
    typeof queueRuntime.activeQueueItemId === "string" &&
    Number.isInteger(queueRuntime.activeTabId)
  ) {
    const activeTabState = await getQueueTabState(queueRuntime.activeTabId);
    if (activeTabState === "loading" || activeTabState === "missing") {
      const queueItems = await getQueueItems();
      const activeIndex = queueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
      if (activeIndex >= 0 && isQueueItemActiveStatus(queueItems[activeIndex].status)) {
        const nextQueueItems = [...queueItems];
        nextQueueItems[activeIndex] = markQueueItemFailed(
          queueItems[activeIndex],
          activeTabState === "loading" ? QUEUE_TAB_LOAD_TIMEOUT_MESSAGE : QUEUE_TAB_CLOSED_MESSAGE
        );
        await saveQueueItems(nextQueueItems);
      }

      if (activeTabState === "loading") {
        await closeTabIfPresent(queueRuntime.activeTabId);
      }

      const nextRuntime = {
        ...clearQueueRuntimeActive(queueRuntime),
        updatedAt: Date.now()
      };
      await saveQueueRuntime(nextRuntime);
    }
  }

  runQueueEngineSoon("alarm");
}

async function handleQueueTabUpdated(tabId, changeInfo) {
  if (changeInfo.status !== "complete") {
    return;
  }

  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    return;
  }

  if (!Number.isInteger(queueRuntime.activeTabId) || queueRuntime.activeTabId !== tabId) {
    return;
  }

  runQueueEngineSoon("tab-updated");
}

async function handleQueueTabRemoved(tabId) {
  const queueRuntime = await getQueueRuntime();
  if (!Number.isInteger(queueRuntime.activeTabId) || queueRuntime.activeTabId !== tabId) {
    return;
  }

  const queueItems = await getQueueItems();
  const activeIndex = queueItems.findIndex((item) => item.id === queueRuntime.activeQueueItemId);
  if (activeIndex >= 0 && isQueueItemActiveStatus(queueItems[activeIndex].status)) {
    const nextQueueItems = [...queueItems];
    nextQueueItems[activeIndex] = markQueueItemFailed(queueItems[activeIndex], QUEUE_TAB_CLOSED_MESSAGE);
    await saveQueueItems(nextQueueItems);
  }

  const nextRuntime = {
    ...clearQueueRuntimeActive(queueRuntime),
    updatedAt: Date.now()
  };
  await saveQueueRuntime(nextRuntime);

  if (queueRuntime.status === "running") {
    runQueueEngineSoon("tab-removed");
  }
}

async function recoverQueueEngineState() {
  const queueRuntime = await getQueueRuntime();
  if (queueRuntime.status !== "running") {
    return;
  }

  runQueueEngineSoon("recover");
}

async function scheduleQueueAlarm() {
  try {
    await chrome.alarms.create(QUEUE_ALARM_NAME, {
      delayInMinutes: QUEUE_ALARM_DELAY_MINUTES
    });
  } catch (error) {
    console.error("[zotero-archivist] Failed to schedule queue alarm.", error);
  }
}

async function clearQueueAlarm() {
  try {
    await chrome.alarms.clear(QUEUE_ALARM_NAME);
  } catch (error) {
    console.error("[zotero-archivist] Failed to clear queue alarm.", error);
  }
}

async function getQueueTabState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      return "missing";
    }

    return tab.status === "complete" ? "complete" : "loading";
  } catch (_error) {
    return "missing";
  }
}

async function closeTabIfPresent(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  try {
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    // Tab may already be closed.
  }
}

async function saveQueueItemWithProvider({ queueItem, tabId }) {
  const { provider, diagnostics } = await resolveSaveProvider({ tabId });
  if (!provider || typeof provider.saveWebPageWithSnapshot !== "function") {
    const unavailableMessage = diagnostics.connectorBridge.enabled
      ? `Connector bridge is unavailable. ${diagnostics.connectorBridge.details}`
      : CONNECTOR_BRIDGE_DISABLED_MESSAGE;
    await saveProviderDiagnostics({
      ...diagnostics,
      lastError: unavailableMessage,
      updatedAt: Date.now()
    });
    return {
      ok: false,
      error: unavailableMessage
    };
  }

  let providerResult;
  try {
    providerResult = await provider.saveWebPageWithSnapshot({
      tabId,
      url: queueItem.url,
      title: queueItem.title
    });
  } catch (error) {
    const thrownMessage = `Provider ${provider.mode} threw: ${String(error)}`;
    await saveProviderDiagnostics({
      ...diagnostics,
      lastError: thrownMessage,
      updatedAt: Date.now()
    });
    return {
      ok: false,
      error: thrownMessage
    };
  }

  if (providerResult?.ok === true) {
    await saveProviderDiagnostics({
      ...diagnostics,
      updatedAt: Date.now()
    });
    return {
      ok: true
    };
  }

  const providerError =
    typeof providerResult?.error === "string" && providerResult.error.length > 0
      ? providerResult.error
      : `Provider ${provider.mode} failed to save the page.`;
  await saveProviderDiagnostics({
    ...diagnostics,
    lastError: providerError,
    updatedAt: Date.now()
  });
  return {
    ok: false,
    error: providerError
  };
}

async function resolveSaveProvider({ tabId = null } = {}) {
  const providerSettings = await getProviderSettings();
  let activeProvider = null;
  let connectorHealth = null;

  if (providerSettings.connectorBridgeEnabled) {
    const connectorBridgeProvider = createConnectorBridgeProvider();
    try {
      connectorHealth = await connectorBridgeProvider.checkHealth({ tabId });
    } catch (error) {
      connectorHealth = {
        ok: false,
        details: `Connector bridge health check failed: ${String(error)}`,
        connectorAvailable: null,
        zoteroOnline: null
      };
    }

    if (connectorHealth.ok === true) {
      activeProvider = connectorBridgeProvider;
    }
  }

  const connectorDetails = providerSettings.connectorBridgeEnabled
    ? normalizeDetailsText(
        connectorHealth?.details,
        "Connector bridge health check returned no details."
      )
    : CONNECTOR_BRIDGE_DISABLED_MESSAGE;

  const diagnostics = {
    activeMode: activeProvider?.mode ?? "connector_bridge",
    connectorBridge: {
      enabled: providerSettings.connectorBridgeEnabled,
      healthy: providerSettings.connectorBridgeEnabled && connectorHealth?.ok === true,
      connectorAvailable:
        connectorHealth?.connectorAvailable === true
          ? true
          : connectorHealth?.connectorAvailable === false
            ? false
            : null,
      zoteroOnline:
        connectorHealth?.zoteroOnline === true
          ? true
          : connectorHealth?.zoteroOnline === false
            ? false
            : null,
      details: connectorDetails
    },
    lastError: null,
    updatedAt: Date.now()
  };

  await saveProviderDiagnostics(diagnostics);

  return {
    provider: activeProvider,
    diagnostics
  };
}

async function refreshProviderDiagnostics(_reason) {
  const { diagnostics } = await resolveSaveProvider();
  return diagnostics;
}

function normalizeDetailsText(details, fallback) {
  if (typeof details === "string" && details.trim().length > 0) {
    return details.trim();
  }

  return fallback;
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

async function ensureQueueRuntime() {
  await getQueueRuntime();
}

async function ensureProviderSettings() {
  await getProviderSettings();
}

async function ensureProviderDiagnostics() {
  await getProviderDiagnostics();
  await refreshProviderDiagnostics("startup");
}

async function getProviderSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_SETTINGS);
  const rawProviderSettings = stored[STORAGE_KEYS.PROVIDER_SETTINGS];
  const providerSettings = normalizeProviderSettings(rawProviderSettings);

  const needsWriteBack =
    !rawProviderSettings || JSON.stringify(rawProviderSettings) !== JSON.stringify(providerSettings);
  if (needsWriteBack) {
    await saveProviderSettings(providerSettings);
  }

  return providerSettings;
}

async function saveProviderSettings(providerSettings) {
  const normalized = normalizeProviderSettings(providerSettings);
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROVIDER_SETTINGS]: normalized
  });
}

async function getProviderDiagnostics() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_DIAGNOSTICS);
  const rawProviderDiagnostics = stored[STORAGE_KEYS.PROVIDER_DIAGNOSTICS];
  const providerDiagnostics = normalizeProviderDiagnostics(rawProviderDiagnostics);

  const needsWriteBack =
    !rawProviderDiagnostics ||
    JSON.stringify(rawProviderDiagnostics) !== JSON.stringify(providerDiagnostics);
  if (needsWriteBack) {
    await saveProviderDiagnostics(providerDiagnostics);
  }

  return providerDiagnostics;
}

async function saveProviderDiagnostics(providerDiagnostics) {
  const normalized = normalizeProviderDiagnostics(providerDiagnostics);
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROVIDER_DIAGNOSTICS]: normalized
  });
}

async function getQueueItems() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE_ITEMS);
  const rawQueueItems = stored[STORAGE_KEYS.QUEUE_ITEMS];
  const queueItems = normalizeQueueItems(rawQueueItems);

  const needsWriteBack =
    !Array.isArray(rawQueueItems) || JSON.stringify(rawQueueItems) !== JSON.stringify(queueItems);

  if (needsWriteBack) {
    await saveQueueItems(queueItems);
  }

  return queueItems;
}

async function saveQueueItems(queueItems) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_ITEMS]: queueItems
  });
}

async function getQueueRuntime() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE_RUNTIME);
  const rawQueueRuntime = stored[STORAGE_KEYS.QUEUE_RUNTIME];
  const queueRuntime = normalizeQueueRuntime(rawQueueRuntime);

  const needsWriteBack =
    !rawQueueRuntime || JSON.stringify(rawQueueRuntime) !== JSON.stringify(queueRuntime);

  if (needsWriteBack) {
    await saveQueueRuntime(queueRuntime);
  }

  return queueRuntime;
}

async function saveQueueRuntime(queueRuntime) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.QUEUE_RUNTIME]: queueRuntime
  });
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

function normalizeQueueRuntime(input) {
  const now = Date.now();
  if (!input || typeof input !== "object") {
    return {
      status: "idle",
      activeQueueItemId: null,
      activeTabId: null,
      updatedAt: now
    };
  }

  const status =
    typeof input.status === "string" && QUEUE_RUNTIME_STATUSES.has(input.status)
      ? input.status
      : "idle";

  const activeQueueItemId =
    typeof input.activeQueueItemId === "string" && input.activeQueueItemId.length > 0
      ? input.activeQueueItemId
      : null;

  const activeTabId = Number.isInteger(input.activeTabId) ? input.activeTabId : null;

  const updatedAt =
    Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? Math.trunc(input.updatedAt) : now;

  if (status === "idle") {
    return {
      status,
      activeQueueItemId: null,
      activeTabId: null,
      updatedAt
    };
  }

  if (activeQueueItemId === null || activeTabId === null) {
    return {
      status,
      activeQueueItemId: null,
      activeTabId: null,
      updatedAt
    };
  }

  return {
    status,
    activeQueueItemId,
    activeTabId,
    updatedAt
  };
}

function markQueueItemFailed(queueItem, message) {
  return {
    ...queueItem,
    status: "failed",
    lastError: message,
    updatedAt: Date.now()
  };
}

function createQueueItemId(timestamp, index) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `queue-${crypto.randomUUID()}`;
  }
  return `queue-${timestamp}-${index}`;
}

function clearQueueRuntimeActive(queueRuntime) {
  return {
    ...queueRuntime,
    activeQueueItemId: null,
    activeTabId: null
  };
}

function isQueueItemActiveStatus(status) {
  return QUEUE_ACTIVE_ITEM_STATUSES.has(status);
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
