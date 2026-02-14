import {
  clearQueueRuntimeActive,
  isQueueItemActiveStatus,
  markQueueItemFailed
} from "../shared/state.js";

export const QUEUE_ENGINE_ALARM_NAME = "queue-engine-watchdog";
const QUEUE_ALARM_DELAY_MINUTES = 1;
const QUEUE_TAB_LOAD_TIMEOUT_MESSAGE = "Queue tab did not finish loading before timeout.";
const QUEUE_TAB_CLOSED_MESSAGE = "Queue tab was closed before loading completed.";

export function createQueueEngine({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  saveQueueItemWithProvider
}) {
  let queueEngineRun = Promise.resolve();

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
      await chrome.alarms.create(QUEUE_ENGINE_ALARM_NAME, {
        delayInMinutes: QUEUE_ALARM_DELAY_MINUTES
      });
    } catch (error) {
      console.error("[zotero-archivist] Failed to schedule queue alarm.", error);
    }
  }

  async function clearQueueAlarm() {
    try {
      await chrome.alarms.clear(QUEUE_ENGINE_ALARM_NAME);
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

  return {
    clearQueueAlarm,
    closeTabIfPresent,
    handleQueueAlarm,
    handleQueueTabRemoved,
    handleQueueTabUpdated,
    recoverQueueEngineState,
    runQueueEngineSoon
  };
}
