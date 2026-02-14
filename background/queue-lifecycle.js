import { ERROR_CODES, createError, createSuccess } from "../shared/protocol.js";
import { clearQueueRuntimeActive, isQueueItemActiveStatus } from "../shared/state.js";

export function createQueueLifecycleHandlers({
  getQueueRuntime,
  saveQueueRuntime,
  getQueueItems,
  saveQueueItems,
  queueEngine
}) {
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

  return {
    clearQueue,
    pauseQueue,
    resumeQueue,
    retryFailedQueue,
    startQueue,
    stopQueue
  };
}
