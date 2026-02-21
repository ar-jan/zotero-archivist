import {
  DEFAULT_QUEUE_SETTINGS,
  clearQueueRuntimeActive,
  isQueueItemActiveStatus,
  markQueueItemFailed,
  normalizeQueueSettings
} from "../shared/state.js";

export const QUEUE_ENGINE_ALARM_NAME = "queue-engine-watchdog";
const QUEUE_ALARM_DELAY_MINUTES = 1;
const QUEUE_INTER_ITEM_DELAY_MIN_MS = 0;
const QUEUE_TAB_LOAD_MAX_WAIT_MS = 10 * 60 * 1000;
const QUEUE_TAB_LOAD_TIMEOUT_MESSAGE = "Queue tab did not finish loading before timeout.";
const QUEUE_TAB_CLOSED_MESSAGE = "Queue tab was closed before loading completed.";

export function createQueueEngine({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  saveQueueItemWithProvider,
  getQueueSettings = async () => ({ ...DEFAULT_QUEUE_SETTINGS }),
  randomImpl = Math.random,
  setQueueEngineDelayTimerImpl = (delayMs, callback) => setTimeout(callback, delayMs),
  clearQueueEngineDelayTimerImpl = (timerId) => clearTimeout(timerId)
}) {
  let queueEngineRun = Promise.resolve();
  let queueEngineDelayTimerId = null;

  function enqueueQueueEngineTask(trigger, task) {
    queueEngineRun = queueEngineRun
      .catch(() => undefined)
      .then(() => task())
      .catch((error) => {
        console.error("[webpage-archivist] Queue engine task failed.", { trigger, error });
      });
    return queueEngineRun;
  }

  function runQueueEngineSoon(trigger) {
    return enqueueQueueEngineTask(trigger, () => runQueueEngine(trigger));
  }

  async function runQueueEngine(_trigger) {
    let queueRuntime = await getQueueRuntime();
    if (queueRuntime.status !== "running") {
      clearQueueEngineDelayTimer();
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
        await scheduleNextQueueRun("missing-active-tab-id");
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
        if (isQueueItemActiveStatus(queueItems[activeIndex].status)) {
          queueItems[activeIndex] = markQueueItemFailed(queueItems[activeIndex], QUEUE_TAB_CLOSED_MESSAGE);
          await saveQueueItems(queueItems);
        }
        await scheduleNextQueueRun("active-tab-missing");
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
      const queueSettings = await getQueueSettingsSafely();
      const normalizedQueueSettings = normalizeQueueSettings(queueSettings);

      const saveResult = await saveQueueItemWithProvider({
        queueItem: itemForSave,
        tabId: activeTabId,
        zoteroSaveMode: normalizedQueueSettings.zoteroSaveMode
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

        await scheduleNextQueueRun("save-success");
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

      await scheduleNextQueueRun("save-failed");
      return;
    }

    queueRuntime = await getQueueRuntime();
    if (queueRuntime.status !== "running") {
      clearQueueEngineDelayTimer();
      await clearQueueAlarm();
      return;
    }

    if (shouldWaitForInterItemDelay(queueRuntime)) {
      scheduleQueueEngineDelayRun(queueRuntime.nextRunAt, "inter-item-delay");
      return;
    }

    if (Number.isFinite(queueRuntime.nextRunAt)) {
      queueRuntime = await saveQueueRuntime({
        ...queueRuntime,
        nextRunAt: null,
        updatedAt: Date.now()
      });
    }

    queueItems = await getQueueItems();
    const nextItemIndex = queueItems.findIndex((item) => item.status === "pending");
    if (nextItemIndex < 0) {
      clearQueueEngineDelayTimer();
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
      const tabCreateOptions = {
        url: itemToRun.url,
        active: false
      };
      if (Number.isInteger(queueRuntime.controllerWindowId)) {
        tabCreateOptions.windowId = queueRuntime.controllerWindowId;
      }

      const openedTab = await chrome.tabs.create(tabCreateOptions);
      openedTabId = openedTab?.id;
    } catch (error) {
      nextQueueItems[nextItemIndex] = markQueueItemFailed(
        itemToRun,
        `Failed to open queue tab: ${String(error)}`
      );
      await saveQueueItems(nextQueueItems);
      await scheduleNextQueueRun("tab-create-error");
      return;
    }

    if (!Number.isInteger(openedTabId)) {
      nextQueueItems[nextItemIndex] = markQueueItemFailed(itemToRun, "Queue tab did not provide a tab id.");
      await saveQueueItems(nextQueueItems);
      await scheduleNextQueueRun("missing-tab-id");
      return;
    }

    clearQueueEngineDelayTimer();
    const nextRuntime = {
      ...queueRuntime,
      activeQueueItemId: itemToRun.id,
      activeTabId: openedTabId,
      nextRunAt: null,
      updatedAt: Date.now()
    };
    await saveQueueRuntime(nextRuntime);
    await scheduleQueueAlarm();
  }

  async function handleQueueAlarm() {
    return enqueueQueueEngineTask("alarm", async () => {
      await handleQueueAlarmInternal();
    });
  }

  async function handleQueueAlarmInternal() {
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
        const activeQueueItem = activeIndex >= 0 ? queueItems[activeIndex] : null;
        if (
          activeTabState === "loading" &&
          activeQueueItem &&
          isQueueItemActiveStatus(activeQueueItem.status) &&
          !hasQueueTabLoadTimedOut(activeQueueItem)
        ) {
          await scheduleQueueAlarm();
          return;
        }

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

        await scheduleNextQueueRun("alarm-timeout");
        return;
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
    return enqueueQueueEngineTask("tab-removed", async () => {
      await handleQueueTabRemovedInternal(tabId);
    });
  }

  async function handleQueueTabRemovedInternal(tabId) {
    const queueRuntime = await getQueueRuntime();
    if (queueRuntime.status !== "running") {
      return;
    }

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

    await scheduleNextQueueRun("tab-removed");
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
      await chrome.alarms.create(QUEUE_ENGINE_ALARM_NAME, {
        delayInMinutes: QUEUE_ALARM_DELAY_MINUTES
      });
    } catch (error) {
      console.error("[webpage-archivist] Failed to schedule queue alarm.", error);
    }
  }

  async function clearQueueAlarm() {
    try {
      await chrome.alarms.clear(QUEUE_ENGINE_ALARM_NAME);
    } catch (error) {
      console.error("[webpage-archivist] Failed to clear queue alarm.", error);
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

  function waitForIdle() {
    return queueEngineRun;
  }

  async function scheduleNextQueueRun(trigger) {
    const latestQueueRuntime = await getQueueRuntime();
    const nextRuntimeBase = clearQueueRuntimeActive(latestQueueRuntime);

    if (latestQueueRuntime.status !== "running") {
      clearQueueEngineDelayTimer();
      await saveQueueRuntime({
        ...nextRuntimeBase,
        updatedAt: Date.now()
      });
      await clearQueueAlarm();
      return;
    }

    const delayMs = await resolveInterItemDelayMs();
    const now = Date.now();
    const nextRuntime = {
      ...nextRuntimeBase,
      nextRunAt: now + delayMs,
      updatedAt: now
    };
    await saveQueueRuntime(nextRuntime);
    await clearQueueAlarm();
    scheduleQueueEngineDelayRun(nextRuntime.nextRunAt, `${trigger}-delayed`);
  }

  function scheduleQueueEngineDelayRun(nextRunAt, trigger) {
    const delayMs = Math.max(
      QUEUE_INTER_ITEM_DELAY_MIN_MS,
      Math.trunc(nextRunAt) - Date.now()
    );

    clearQueueEngineDelayTimer();
    if (delayMs === 0) {
      runQueueEngineSoon(trigger);
      return;
    }

    queueEngineDelayTimerId = setQueueEngineDelayTimerImpl(delayMs, () => {
      queueEngineDelayTimerId = null;
      runQueueEngineSoon(trigger);
    });
  }

  function clearQueueEngineDelayTimer() {
    if (queueEngineDelayTimerId === null || queueEngineDelayTimerId === undefined) {
      return;
    }

    clearQueueEngineDelayTimerImpl(queueEngineDelayTimerId);
    queueEngineDelayTimerId = null;
  }

  function shouldWaitForInterItemDelay(queueRuntime) {
    return Number.isFinite(queueRuntime?.nextRunAt) && queueRuntime.nextRunAt > Date.now();
  }

  async function resolveInterItemDelayMs() {
    const queueSettings = await getQueueSettingsSafely();
    const normalizedQueueSettings = normalizeQueueSettings(queueSettings);

    if (normalizedQueueSettings.interItemDelayJitterMs <= 0) {
      return normalizedQueueSettings.interItemDelayMs;
    }

    const randomValue = normalizeRandomValue(randomImpl());
    const jitterOffset = Math.round(
      (randomValue * 2 - 1) * normalizedQueueSettings.interItemDelayJitterMs
    );

    return Math.max(
      QUEUE_INTER_ITEM_DELAY_MIN_MS,
      normalizedQueueSettings.interItemDelayMs + jitterOffset
    );
  }

  async function getQueueSettingsSafely() {
    try {
      return await getQueueSettings();
    } catch (error) {
      console.error("[webpage-archivist] Failed to read queue settings.", error);
      return { ...DEFAULT_QUEUE_SETTINGS };
    }
  }

  return {
    clearQueueAlarm,
    closeTabIfPresent,
    handleQueueAlarm,
    handleQueueTabRemoved,
    handleQueueTabUpdated,
    recoverQueueEngineState,
    runQueueEngineSoon,
    waitForIdle
  };
}

function hasQueueTabLoadTimedOut(queueItem, now = Date.now()) {
  if (!queueItem || !Number.isFinite(queueItem.updatedAt) || queueItem.updatedAt <= 0) {
    return true;
  }

  return now - queueItem.updatedAt >= QUEUE_TAB_LOAD_MAX_WAIT_MS;
}

function normalizeRandomValue(value) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
